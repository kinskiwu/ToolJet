import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import * as compression from 'compression';
import { AppModule } from './app.module';
import * as helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { urlencoded, json } from 'express';
import { AllExceptionsFilter } from './all-exceptions-filter';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import { bootstrap as globalAgentBootstrap } from 'global-agent';
import { custom } from 'openid-client';

const fs = require('fs');

globalThis.TOOLJET_VERSION = fs.readFileSync('./.version', 'utf8').trim();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  const configService = app.get<ConfigService>(ConfigService);
  const host = new URL(process.env.TOOLJET_HOST);
  const domain = host.hostname;

  custom.setHttpOptionsDefaults({
    timeout: parseInt(process.env.OIDC_CONNECTION_TIMEOUT || '3500'), // Default 3.5 seconds
  });

  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AllExceptionsFilter(app.get(Logger)));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useWebSocketAdapter(new WsAdapter(app));

  const UrlPrefix = process.env.SUB_PATH === undefined ? '' : process.env.SUB_PATH;

  app.setGlobalPrefix(UrlPrefix + 'api');
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.use(compression());

  app.use(
    helmet.contentSecurityPolicy({
      useDefaults: true,
      directives: {
        upgradeInsecureRequests: null,
        'img-src': ['*', 'data:', 'blob:'],
        'script-src': [
          'maps.googleapis.com',
          'apis.google.com',
          'accounts.google.com',
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          'blob:',
          'https://unpkg.com/@babel/standalone@7.17.9/babel.min.js',
          'https://unpkg.com/react@16.7.0/umd/react.production.min.js',
          'https://unpkg.com/react-dom@16.7.0/umd/react-dom.production.min.js',
          'cdn.skypack.dev',
        ],
        'default-src': [
          'maps.googleapis.com',
          'apis.google.com',
          'accounts.google.com',
          '*.sentry.io',
          "'self'",
          'blob:',
        ],
        'connect-src': ['ws://' + domain, "'self'", '*'],
        'frame-ancestors': ['*'],
        'frame-src': ['*'],
      },
    })
  );

  app.use(cookieParser());
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb', parameterLimit: 1000000 }));

  const port = parseInt(process.env.PORT) || 3000;

  await app.listen(port, '0.0.0.0', function () {
    const tooljetHost = configService.get<string>('TOOLJET_HOST');
    console.log(`Ready to use at ${tooljetHost} 🚀`);
  });
}

// Bootstrap global agent only if TOOLJET_HTTP_PROXY is set
if (process.env.TOOLJET_HTTP_PROXY) {
  process.env['GLOBAL_AGENT_HTTP_PROXY'] = process.env.TOOLJET_HTTP_PROXY;
  globalAgentBootstrap();
}
// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
