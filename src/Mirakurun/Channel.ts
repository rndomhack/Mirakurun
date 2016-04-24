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
import * as common from './common';
import * as log from './log';
import * as config from './config';
import _ from './_';
import queue from './queue';
import ChannelItem from './ChannelItem';
import Tuner from './Tuner';

export default class Channel {

    private _items: ChannelItem[] = [];
    private _epgGatherInterval: number = 60 * 60 * 1000;

    constructor() {

        _.channel = this;

        this._load();

        setTimeout(this._epgGatherer.bind(this), 60 * 1000);
    }

    add(item: ChannelItem): void {

        if (this.get(item.type, item.channel) === null) {
            this._items.push(item);
        }
    }

    remove(item: ChannelItem): void {

        const index = this._items.indexOf(item);

        if (index !== -1) {
            this._items.splice(index, 1);
        }
    }

    get(type: common.ChannelType, channel: string): ChannelItem {
        return this._items.find(item => item.channel === channel && item.type === type) || null;
    }

    all(): ChannelItem[] {
        return this._items;
    }

    exists(type: common.ChannelType, channel: string): boolean {
        return this._items.some(item => item.channel === channel && item.type === type);
    }

    findByType(type: common.ChannelType): ChannelItem[] {
        return this._items.filter(item => item.type === type);
    }

    private _load(): void {

        log.debug('loading channels...');

        const channels = config.loadChannels();

        channels.forEach((channel, i) => {

            if (typeof channel.name !== 'string') {
                log.error('invalid type of property `name` in channel#%d configuration', i);
                return;
            }

            if (channel.type !== 'GR' && channel.type !== 'BS' && channel.type !== 'CS' && channel.type !== 'SKY') {
                log.error('invalid type of property `type` in channel#%d (%s) configuration', i, channel.name);
                return;
            }

            if (typeof channel.channel !== 'string') {
                log.error('invalid type of property `channel` in channel#%d (%s) configuration', i, channel.name);
                return;
            }

            if (channel.satelite && typeof channel.satelite !== 'string') {
                log.error('invalid type of property `satelite` in channel#%d (%s) configuration', i, channel.name);
                return;
            }

            if (channel.serviceId && typeof channel.serviceId !== 'number') {
                log.error('invalid type of property `serviceId` in channel#%d (%s) configuration', i, channel.name);
                return;
            }

            if(channel.isDisabled === true) {
                return;
            }

            if (_.tuner.typeExists(channel.type) === false) {
                return;
            }

            if (this.exists(channel.type, channel.channel)) {
                const item = this.get(channel.type, channel.channel);

                if (channel.serviceId !== void 0) {
                    item.addService(channel.serviceId);
                }
            } else {
                const item = new ChannelItem(channel);

                if (channel.serviceId !== void 0) {
                    item.addService(channel.serviceId);
                }

                this.add(item);
            }
        });
    }

    private _epgGatherer(): void {

        queue.add(() => {

            const networkIds = [...new Set(_.service.all().map(item => item.networkId))];

            networkIds.forEach(networkId => {

                const services = _.service.findByNetworkId(networkId);

                if (services.length === 0) {
                    return;
                }

                queue.add(() => {
                    return new Promise((resolve, reject) => {

                        log.info('Network#%d EPG gathering has started', networkId);

                        _.tuner.getEPG(services[0].channel)
                            .then(() => {
                                log.info('Network#%d EPG gathering has finished', networkId);
                                resolve();
                            })
                            .catch(error => {
                                log.error('Network#%d EPG gathering has failed [%s]', networkId, error);
                                reject();
                            });
                    });
                });
            });

            queue.add(() => {
                setTimeout(this._epgGatherer.bind(this), this._epgGatherInterval);
                return Promise.resolve();
            });

            return Promise.resolve();
        });
    }
}