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

import _ from './_';
import * as log from './log';

const Wake = require('win-wake');
const Resume = require('win-resume');

export default class Power {

    private _wake: any;
    private _resume: any;
    private _resumeDate: Date;
    private _wakeSet: Set<Object>;
    private _resumeSet: Set<Date>;

    constructor() {

        this._wake = null;
        this._resume = null;
        this._resumeDate = null;
        this._wakeSet = new Set();
        this._resumeSet = new Set();

        _.power = this;
    }

    addWake(obj: Object): boolean {

        if (this._wakeSet.has(obj)) return false;

        this._wakeSet.add(obj);
        this.checkWake();

        return true;
    }

    removeWake(obj: Object): boolean {

        if (!this._wakeSet.has(obj)) return false;

        this._wakeSet.delete(obj);
        this.checkWake();

        return true;
    }

    checkWake() {

        if (this._wakeSet.size === 0) {
            if (this._wake !== null) {
                if (process.platform === 'win32') {
                    this._wake.stop()
                    this._wake = null;

                    log.debug('Power stop preventing from sleep');
                } else {
                    // TODO
                }
            }
        } else {
            if (this._wake === null) {
                if (process.platform === 'win32') {
                    this._wake = new Wake();
                    this._wake.start();

                    log.debug('Power start preventing from sleep');
                } else {
                    // TODO
                }
            }
        }
    }

    addResume(date: Date): boolean {

        if (this._resumeSet.has(date)) return false;

        this._resumeSet.add(date);
        this.checkResume();

        return true;
    }

    removeResume(date: Date): boolean {

        if (!this._resumeSet.has(date)) return false;

        this._resumeSet.delete(date);
        this.checkResume();

        return true;
    }

    checkResume() {
        let recent: Date = null;

        for (let date of this._resumeSet) {
            if (date.getTime() < Date.now()) {
                this._resumeSet.delete(date);
                continue;
            }

            if (recent === null || date.getTime() < recent.getTime()) {
                recent = date;
            }
        }

        if (this._resumeSet.size === 0) {
            if (this._resume !== null) {
                if (process.platform === 'win32') {
                    this._resume.stop();
                    this._resume = null;

                    log.debug('Power stop resume timer (timer=%s)', this._resumeDate.toString());

                    this._resumeDate = null;
                } else {
                    // TODO
                }
            }
        } else {
            if (process.platform === 'win32') {
                if (this._resumeDate === recent) return;

                this._resume = new Resume({time: recent});
                this._resume.start();

                this._resume.on("end", () => {
                    this._resumeSet.delete(recent);
                    this._resume = null;
                    this._resumeDate = null;

                    this.checkResume();
                });

                log.debug('Power start resume timer (timer=%s)', recent.toString());

                this._resumeDate = recent;
            } else {
                // TODO
            }
        }
    }
}