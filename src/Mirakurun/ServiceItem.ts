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
import _ from './_';
import db from './db';
import ChannelItem from './ChannelItem';

export default class ServiceItem {

    private _removed: boolean = false;

    constructor(private _data: db.Service) {

        _.service.add(this);

        this._updated();
    }

    get id(): number {
        return this._data.id;
    }

    get networkId(): number {
        return this._data.networkId;
    }

    get serviceId(): number {
        return this._data.serviceId;
    }

    get name(): string {
        return this._data.name;
    }

    get channel(): ChannelItem {
        return _.channel.get(this._data.channel.type, this._data.channel.channel);
    }

    remove(): void {
        _.service.remove(this);
        _.service.save();

        this._removed = true;
    }

    update(data: db.Service) {

        if (data.id !== this._data.id) {
            if (_.service.exists(data.id)) {
                _.service.remove(this);
                _.service.save();

                this._removed = true;
                return;
            }
        }

        if (common.updateObject(this._data, data)) {
            _.service.save();

            this._updated();
        }
    }

    export(): db.Service {
        return this._data;
    }

    getStream(user: common.User): Promise<stream.Readable> {
        return _.tuner.getServiceStream(this, user);
    }

    private _updated(): void {
        _.event.emit('service', this.export());
    }

    static createId(networkId: number, serviceId: number): number {
        return parseInt(networkId + (serviceId / 100000).toFixed(5).slice(2), 10);
    }
}