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
import * as fs from 'fs';
import * as log from './log';
import _ from './_';
import db from './db';
import ServiceItem from './ServiceItem';
import ProgramItem from './ProgramItem';

export default class Program {

    private _items: ProgramItem[] = [];
    private _saveTimerId: NodeJS.Timer;

    constructor() {

        _.program = this;

        this._load();

        setInterval(this._gc.bind(this), 1000 * 60 * 15);
    }

    add(item: ProgramItem): void {

        if (this.get(item.id) === null) {
            this._items.push(item);

            this.save();
        }
    }

    remove(item: ProgramItem): void {

        const index = this._items.indexOf(item);

        if (index !== -1) {
            this._items.splice(index, 1);

            this.save();
        }
    }

    get(id: number): ProgramItem {
        return this._items.find(item => item.data.id === id) || null;
    }

    all(): ProgramItem[] {
        return this._items;
    }

    exists(id: number): boolean {
        return this._items.some(item => item.data.id === id);
    }

    findByServiceId(serviceId: number): ProgramItem[] {
        return this._items.filter(item => item.data.serviceId === serviceId);
    }

    findByServiceItemId(id: number): ProgramItem[] {
        return this._items.filter(item => item.data.id === id);
    }

    save(): void {
        clearTimeout(this._saveTimerId);
        this._saveTimerId = setTimeout(() => this._save(), 5 * 1000);
    }

    private _load(): void {

        log.debug('loading programs...');

        const now = Date.now();
        let dropped = false;

        db.loadPrograms().forEach(program => {

            if (program.networkId === void 0) {
                dropped = true;
                return;
            }
            if (now > (program.startAt + program.duration)) {
                dropped = true;
                return;
            }

            new ProgramItem(program);
        });

        if (dropped === true) {
            this.save();
        }
    }

    private _save(): void {

        log.debug('saving programs...');

        db.savePrograms(
            this._items.map(program => program.data)
        );
    }

    private _gc(): void {

        const now = Date.now();

        this._items.forEach(program => {
            if (now > (program.data.startAt + program.data.duration)) {
                program.remove();
            }
        });
    }

    static add(item: ProgramItem): void {
        return _.program.add(item);
    }

    static get(id: number): ProgramItem {
        return _.program.get(id);
    }

    static remove(item: ProgramItem): void {
        return _.program.remove(item);
    }

    static exists(id: number): boolean {
        return _.program.exists(id);
    }

    static findByServiceId(serviceId: number): ProgramItem[] {
        return _.program.findByServiceId(serviceId);
    }

    static findByServiceItemId(id: number): ProgramItem[] {
        return _.program.findByServiceItemId(id);
    }

    static all(): ProgramItem[] {
        return _.program.all();
    }

    static save(): void {
        return _.program.save();
    }
}