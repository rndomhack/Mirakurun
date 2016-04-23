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
/// <reference path="../../typings/node/node.d.ts" />
'use strict';

import * as stream from 'stream';
import _ from './_';
import queue from './queue';
import * as log from './log';
import * as common from './common';
import * as config from './config';
import ServiceItem from './ServiceItem';

export default class ChannelItem {

    private _removed: boolean = false;

    constructor(private _config: config.Channel) {

        this._init();

        _.channel.add(this);
    }

    get name(): string {
        return this._config.name;
    }

    get type(): common.ChannelType {
        return this._config.type;
    }

    get channel(): string {
        return this._config.channel;
    }

    get satelite(): string {
        return this._config.satelite;
    }

    remove(): void {
        _.channel.remove(this);

        this._removed = true;
    }

    export(): config.Channel {
        return this._config;
    }

    getServices(): ServiceItem[] {
        return _.service.findByChannel(this);
    }

    getStream(user: common.User): Promise<stream.Readable> {
        return _.tuner.getChannelStream(this, user);
    }

    addService(serviceId: number): void {

        if (this._removed) return;

        if (_.service === void 0 || _.tuner === void 0) {
            process.nextTick(() => this.addService(serviceId));
            return;
        }

        if (_.service.findByChannel(this).some(service => service.serviceId === serviceId)) {
            return;
        }

        log.info('ChannelItem#"%s" serviceId=%d check has queued', this._config.name, serviceId);

        queue.add(() => {
            return new Promise((resolve, reject) => {

                log.info('ChannelItem#"%s" serviceId=%d check has started', this._config.name, serviceId);

                _.tuner.getServices(this)
                    .then(services => {
                        const service = services.find(service => service.serviceId === serviceId);

                        if (service === void 0) {
                            log.debug('ChannelItem#"%s" serviceId=%d service is not found', this._config.name, serviceId);

                            resolve();
                            return;
                        }

                        log.debug('ChannelItem#"%s" serviceId=%d: %s', this._config.name, serviceId, JSON.stringify(service, null, '  '));

                        new ServiceItem(service, this);

                        resolve();
                    })
                    .catch(error => {

                        log.info('ChannelItem#"%s" serviceId=%d check has failed [%s]', this._config.name, serviceId, error);

                        setTimeout(() => this.addService(serviceId), 60 * 1000);

                        reject();
                    });
            });
        });
    }

    serviceScan(add: boolean): void {

        if (this._removed) return;

        log.info('ChannelItem#"%s" service scan has queued', this._config.name);

        queue.add(() => {
            return new Promise((resolve, reject) => {

                log.info('ChannelItem#"%s" service scan has started', this._config.name);

                _.tuner.getServices(this)
                    .then(services => {

                        log.debug('ChannelItem#"%s" services: %s', this._config.name, JSON.stringify(services, null, '  '));

                        services.forEach(service => {

                            if (_.service.exists(service.networkId, service.serviceId)) {
                                const item = _.service.get(service.networkId, service.serviceId);

                                item.update(service);
                            } else if (add) {
                                new ServiceItem(service, this);
                            }
                        });

                        _.service.findByChannel(this).forEach(item => {
                            if (services.some(service => service.id === item.id)) return;

                            item.remove();
                        });

                        log.info('ChannelItem#"%s" service scan has finished', this._config.name);

                        resolve();
                    })
                    .catch(error => {

                        log.error('ChannelItem#"%s" service scan has failed [%s]', this._config.name, error);

                        setTimeout(() => this.serviceScan(add), add ? 60 * 1000 : 10 * 60 * 1000);

                        reject();
                    });
            });
        });
    }

    private _init(): void {

        if (this._removed) return;

        if (_.service === void 0) {
            process.nextTick(() => this._init());
            return;
        }

        if (this._config.serviceId === void 0 && this.getServices().length === 0) {
            process.nextTick(() => this.serviceScan(true));
        } else {
            process.nextTick(() => this.serviceScan(false));
        }
    }
}