/*
   Copyright 2016 Yuki KAN

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
/// <reference path="../../typings/tsd.d.ts" />
'use strict';

import * as fs from 'fs';
import * as http from 'http';
import * as express from 'express';
import * as openapi from 'express-openapi';
import * as morgan from 'morgan';
import * as bodyParser from 'body-parser';
import * as yaml from 'js-yaml';
import * as log from './log';
import * as config from './config';
import regexp from './regexp';
import system from './system';
import Event from './Event';
import Tuner from './Tuner';
import Channel from './Channel';
import Service from './Service';
import Program from './Program';

const pkg = require('../../package.json');

class Server {

    private _servers: http.Server[] = [];

    constructor() {

        const serverConfig = config.loadServer();

        if (typeof serverConfig.logLevel === 'number') {
            log.logLevel = serverConfig.logLevel;
        }

        let addresses: string[] = [];

        if (serverConfig.path) {
            addresses.push(serverConfig.path);
        }

        if (serverConfig.port) {
            addresses = [...addresses, ...system.getPrivateIPv4Addresses(), '127.0.0.1'];
        }

        addresses.forEach(address => {

            const app = express();
            const server = http.createServer(app);

            server.timeout = 1000 * 60 * 3;// 3 minutes

            app.disable('x-powered-by');

            app.use(morgan(':remote-addr :remote-user :method :url HTTP/:http-version :status :res[content-length] - :response-time ms :user-agent'));
            app.use(bodyParser.urlencoded({ extended: false }));
            app.use(bodyParser.json());

            app.use((req: express.Request, res: express.Response, next) => {

                if (regexp.privateIPv4Address.test(req.ip) === true || !req.ip) {
                    res.setHeader('Server', 'Mirakurun/' + pkg.version);
                    next();
                } else {
                    res.status(403).end();
                }
            });

            openapi.initialize({
                app: app,　　　　　　　　　　　　　　　
                apiDoc: yaml.safeLoad(fs.readFileSync('apiDefinition.yml', 'utf8')),
                docsPath: '/docs',
                routes: './lib/Mirakurun/api'
            });

            app.use((err, req, res: express.Response, next) => {

                log.error(JSON.stringify(err, null, '  '));
                console.error(err.stack);

                if (res.headersSent === false) {
                    res.writeHead(err.status || 500, {
                        'Content-Type': 'application/json'
                    });
                }

                res.end(JSON.stringify({
                    code: res.statusCode,
                    reason: err.message || res.statusMessage,
                    errors: err.errors
                }));

                next();
            });

            if (regexp.unixDomainSocket.test(address) === true || regexp.windowsNamedPipe.test(address) === true) {
                if (process.platform !== 'win32' && fs.existsSync(address) === true) {
                    fs.unlinkSync(address);
                }

                server.listen(address, () => {
                    log.info('listening on http+unix://%s', address.replace(/\//g, '%2F'));
                });

                if (process.platform !== 'win32') {
                    fs.chmodSync(address, '777');
                }
            } else {
                server.listen(serverConfig.port, address, () => {
                    log.info('listening on http://%s:%d', address, serverConfig.port);
                });
            }

            this._servers.push(server);
        });

        new Event();
        new Tuner();
        new Channel();
        new Service();
        new Program();
    }
}

export default Server;