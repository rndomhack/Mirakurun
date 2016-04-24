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
import * as log from './log';
import _ from './_';
import db from './db';
import ChannelItem from './ChannelItem';
import ServiceItem from './ServiceItem';

export default class Service {

    private _items: ServiceItem[] = [];
    private _saveTimerId: NodeJS.Timer;

    constructor() {

        _.service = this;

        this._load();
    }

    add(item: ServiceItem): void {

        if (this.get(item.id) === null) {
            this._items.push(item);

            this.save();
        }
    }

    remove(item: ServiceItem): void {

        const index = this._items.indexOf(item);

        if (index !== -1) {
            this._items.splice(index, 1);

            this.save();
        }
    }

    get(id: number): ServiceItem;
    get(networkId: number, serviceId: number): ServiceItem;
    get(id: number, serviceId?: number) {

        return this._items.find(item => {
            if (typeof serviceId === 'undefined') {
                if (item.id !== id) return false;
            } else {
                if (item.networkId !== id || item.serviceId !== serviceId) return false;
            }

            return true;
        }) || null;
    }

    all(): ServiceItem[] {
        return this._items;
    }

    exists(id: number): boolean;
    exists(networkId: number, serviceId: number): boolean;
    exists(id: number, serviceId?: number) {

        return this._items.some(item => {
            if (typeof serviceId === 'undefined') {
                if (item.id !== id) return false;
            } else {
                if (item.networkId !== id || item.serviceId !== serviceId) return false;
            }

            return true;
        });
    }

    findByChannel(channel: ChannelItem): ServiceItem[] {
        return this._items.filter(item => item.channel === channel);
    }

    findByNetworkId(networkId: number): ServiceItem[] {
        return this._items.filter(item => item.networkId === networkId);
    }

    save(): void {
        clearTimeout(this._saveTimerId);
        this._saveTimerId = setTimeout(() => this._save(), 5 * 1000);
    }

    private _load(): void {

        log.debug('loading services...');

        let dropped = false;

        db.loadServices().forEach(service => {

            if (_.channel.exists(service.channel.type, service.channel.channel) === false) {
                dropped = true;
                return;
            }

            if (typeof service.networkId === 'undefined' || typeof service.serviceId === 'undefined') {
                dropped = true;
                return;
            }

            if (this.exists(service.networkId, service.serviceId) === true) {
                dropped = true;
                return;
            }

            new ServiceItem(service);
        });

        if (dropped === true) {
            this.save();
        }
    }

    private _save(): void {

        log.debug('saving services...');

        db.saveServices(
            this._items.map(service => service.export())
        );
    }
}