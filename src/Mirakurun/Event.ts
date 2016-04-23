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

import { EventEmitter } from 'events';
import _ from './_';

interface EventMessage {
    resource: string;
    data: any;
    time: number;
}

export default class Event {

    private _eventEmitter: EventEmitter = new EventEmitter();
    private _log: EventMessage[] = [];

    constructor() {
        
        _.event = this;

        this._eventEmitter.on('event', message => {

            this._log.unshift(message);

            // testing
            if (this._log.length > 100) {
                this._log.pop();
            }
        });
    }

    get log(): EventMessage[] {
        return this._log;
    }

    on(listener: (message: EventMessage) => void): void {
        this._eventEmitter.on('event', listener);
    }

    once(listener: (message: EventMessage) => void): void {
        this._eventEmitter.once('event', listener);
    }

    removeListener(listener: Function): void {
        this._eventEmitter.removeListener('event', listener);
    }

    emit(resource: string, data: any): boolean {

        const message: EventMessage = {
            resource: resource,
            data: data,
            time: Date.now()
        };

        return this._eventEmitter.emit('event', message);
    }
}