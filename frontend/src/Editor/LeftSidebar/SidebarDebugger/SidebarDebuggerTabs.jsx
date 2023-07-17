import React from 'react';
import Tab from 'react-bootstrap/Tab';
import Tabs from 'react-bootstrap/Tabs';
import Logs from './Logs';
import { useTranslation } from 'react-i18next';

const DebuggerTabContent = ({ logs, darkMode }) => {
  const { t } = useTranslation();
  return (
    <div className="card-body mb-5">
      {logs.length === 0 && (
        <center className="p-2 text-muted">{t(`leftSidebar.Debugger.noErrors`, 'No errors found.')}</center>
      )}

      <div className="tab-content">
        {logs.map((error, index) => (
          <Logs key={index} errorProps={error} logProps={error} idx={index} darkMode={darkMode} />
        ))}
      </div>
    </div>
  );
};

const SidebarDebuggerTabs = ({ darkMode, errors, allLog }) => {
  return (
    <Tabs defaultActiveKey="allLog" id="sidebar-debugger" className="mb-3 sidebar-debugger" justify>
      <Tab eventKey="allLog" title="All Log">
        <DebuggerTabContent logs={allLog} darkMode={darkMode} />
      </Tab>
      <Tab eventKey="errors" title="Errors">
        <DebuggerTabContent logs={errors} darkMode={darkMode} />
      </Tab>
    </Tabs>
  );
};

export default SidebarDebuggerTabs;
