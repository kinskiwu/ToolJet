import { CreateWorkflowExecutionDto } from '@dto/create-workflow-execution.dto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AppVersion } from 'src/entities/app_version.entity';
import { App } from 'src/entities/app.entity';
import { WorkflowExecution } from 'src/entities/workflow_execution.entity';
import { WorkflowExecutionNode } from 'src/entities/workflow_execution_node.entity';
import { WorkflowExecutionEdge } from 'src/entities/workflow_execution_edge.entity';
import { dbTransactionWrap } from 'src/helpers/utils.helper';
import { EntityManager, Repository } from 'typeorm';
import { find } from 'lodash';
import { DataQueriesService } from './data_queries.service';
import { User } from 'src/entities/user.entity';
import { getQueryVariables, resolveCode } from 'lib/utils';

@Injectable()
export class WorkflowExecutionsService {
  constructor(
    @InjectRepository(AppVersion)
    private appVersionsRepository: Repository<AppVersion>,

    @InjectRepository(WorkflowExecution)
    private workflowExecutionRepository: Repository<WorkflowExecution>,

    @InjectRepository(WorkflowExecutionEdge)
    private workflowExecutionEdgeRepository: Repository<WorkflowExecutionEdge>,

    @InjectRepository(WorkflowExecutionNode)
    private workflowExecutionNodeRepository: Repository<WorkflowExecutionNode>,

    @InjectRepository(User)
    private userRepository: Repository<User>,

    private dataQueriesService: DataQueriesService
  ) {}

  async create(createWorkflowExecutionDto: CreateWorkflowExecutionDto): Promise<WorkflowExecution> {
    const workflowExecution = await dbTransactionWrap(async (manager: EntityManager) => {
      const appVersionId =
        createWorkflowExecutionDto?.appVersionId ??
        (await manager.findOne(App, createWorkflowExecutionDto.appId)).editingVersion.id;

      const workflowExecution = await manager.save(
        WorkflowExecution,
        manager.create(WorkflowExecution, {
          appVersionId: appVersionId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );

      const appVersion = await this.appVersionsRepository.findOne({ where: { id: workflowExecution.appVersionId } });
      const definition = appVersion.definition;

      const nodes = [];
      for (const nodeData of definition.nodes) {
        const node = await manager.save(
          WorkflowExecutionNode,
          manager.create(WorkflowExecutionNode, {
            type: nodeData.type,
            workflowExecutionId: workflowExecution.id,
            idOnWorkflowDefinition: nodeData.id,
            definition: nodeData.data,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        );

        nodes.push(node);
      }

      const startNode = find(nodes, (node) => node.definition.nodeType === 'start');
      workflowExecution.startNodeId = startNode.id;

      await manager.update(WorkflowExecution, workflowExecution.id, { startNode });

      const edges = [];
      for (const edgeData of definition.edges) {
        // const sourceNode = find(nodes, (node) => node.idOnWorkflowDefinition === edgeData.source);
        // const targetNode = find(nodes, (node) => node.idOnWorkflowDefinition === edgeData.target);

        console.log({ nodes, edges: definition.edges });
        const edge = await manager.save(
          WorkflowExecutionEdge,
          manager.create(WorkflowExecutionEdge, {
            workflowExecutionId: workflowExecution.id,
            idOnWorkflowDefinition: edgeData.id,
            sourceWorkflowExecutionNodeId: find(nodes, (node) => node.idOnWorkflowDefinition === edgeData.source).id,
            targetWorkflowExecutionNodeId: find(nodes, (node) => node.idOnWorkflowDefinition === edgeData.target).id,
            sourceHandle: edgeData.sourceHandle,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        );

        edges.push(edge);
      }

      return workflowExecution;
    });

    return workflowExecution;
  }

  async getStatus(workflowExecutionId: string) {
    const workflowExecution = await this.workflowExecutionRepository.findOne(workflowExecutionId);
    const workflowExecutionNodes = await this.workflowExecutionNodeRepository.find({
      where: {
        workflowExecutionId: workflowExecution.id,
      },
    });

    const nodes = workflowExecutionNodes.map((node) => ({
      id: node.id,
      idOnDefinition: node.idOnWorkflowDefinition,
      executed: node.executed,
      result: node.result,
    }));

    return {
      status: workflowExecution.executed,
      nodes,
    };
  }

  async execute(workflowExecution: WorkflowExecution, params: object = {}): Promise<object> {
    const appVersion = await this.appVersionsRepository.findOne(workflowExecution.appVersionId);

    workflowExecution = await this.workflowExecutionRepository.findOne({
      where: {
        id: workflowExecution.id,
      },
      relations: ['startNode', 'user'],
    });

    const queue = [];

    queue.push(workflowExecution.startNode);

    let finalResult = {};
    while (queue.length !== 0) {
      const nodeToBeExecuted = queue.shift();

      const currentNode = await this.workflowExecutionNodeRepository.findOne({ where: { id: nodeToBeExecuted.id } });

      const { state, previousNodesExecutionCompletionStatus } =
        await this.getStateAndPreviousNodesExecutionCompletionStatus(currentNode);

      // eslint-disable-next-line no-empty
      if (currentNode.executed) {
      } else if (!previousNodesExecutionCompletionStatus) {
        queue.push(currentNode);
      } else {
        switch (currentNode.type) {
          case 'input': {
            await this.completeNodeExecution(currentNode, '', { startTrigger: { params } });
            void queue.push(...(await this.forwardNodes(currentNode)));
            break;
          }

          case 'query': {
            const queryId = find(appVersion.definition.queries, {
              idOnDefinition: currentNode.definition.idOnDefinition,
            }).id;

            const query = await this.dataQueriesService.findOne(queryId);
            const user = await this.userRepository.findOne(workflowExecution.executingUserId, {
              relations: ['organization'],
            });
            user.organizationId = user.organization.id;
            try {
              void getQueryVariables(query.options, state);
            } catch (e) {
              console.log({ e });
            }

            const options = getQueryVariables(query.options, state);
            try {
              const result = await this.dataQueriesService.runQuery(user, query, options);

              const newState = {
                ...state,
                [query.name]: result,
              };

              await this.completeNodeExecution(currentNode, JSON.stringify(result), newState);
              void queue.push(...(await this.forwardNodes(currentNode)));
            } catch (exception) {
              const result = { status: 'failed', exception };

              const newState = {
                ...state,
                [query.name]: result,
              };

              await this.completeNodeExecution(currentNode, JSON.stringify(result), newState);
              queue.push(...(await this.forwardNodes(currentNode)));
              console.log({ exception });
            }

            break;
          }

          case 'if-condition': {
            const code = currentNode.definition?.code ?? '';

            const result = resolveCode(code, state);

            const sourceHandle = result ? 'true' : 'false';

            await this.completeNodeExecution(currentNode, JSON.stringify(result), {});

            void queue.push(...(await this.forwardNodes(currentNode, sourceHandle)));

            break;
          }

          case 'output': {
            finalResult = { ...state };
            break;
          }
        }
      }
    }

    await this.markWorkflowAsExecuted(workflowExecution);

    return finalResult;
  }

  async completeNodeExecution(node: WorkflowExecutionNode, result: any, state: object) {
    await dbTransactionWrap(async (manager: EntityManager) => {
      await manager.update(WorkflowExecutionNode, node.id, { executed: true, result, state });
    });
  }

  async markWorkflowAsExecuted(workflow: WorkflowExecution) {
    await dbTransactionWrap(async (manager: EntityManager) => {
      await manager.update(WorkflowExecution, workflow.id, { executed: true });
    });
  }

  async getStateAndPreviousNodesExecutionCompletionStatus(node: WorkflowExecutionNode) {
    const incomingEdges = await this.workflowExecutionEdgeRepository.find({
      where: {
        targetWorkflowExecutionNodeId: node.id,
      },
      relations: ['sourceWorkflowExecutionNode'],
    });

    const incomingNodes = await Promise.all(incomingEdges.map((edge) => edge.sourceWorkflowExecutionNode));

    const previousNodesExecutionCompletionStatus = !incomingNodes.map((node) => node.executed).includes(false);

    const state = incomingNodes.reduce((existingState, node) => {
      const nodeState = node.state ?? {};
      return { ...existingState, ...nodeState };
    }, {});

    return { state, previousNodesExecutionCompletionStatus };
  }

  async forwardNodes(
    startNode: WorkflowExecutionNode,
    sourceHandle: string = undefined
  ): Promise<WorkflowExecutionNode[]> {
    const forwardEdges = await this.workflowExecutionEdgeRepository.find({
      where: {
        sourceWorkflowExecutionNode: startNode,
        ...(sourceHandle ? { sourceHandle } : {}),
      },
    });

    const forwardNodeIds = forwardEdges.map((edge) => edge.targetWorkflowExecutionNodeId);

    const forwardNodes = Promise.all(
      forwardNodeIds.map((id) =>
        this.workflowExecutionNodeRepository.findOne({
          where: {
            id,
          },
        })
      )
    );

    return forwardNodes;
  }
}