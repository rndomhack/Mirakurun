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

import * as events from 'events';
import * as child_process from 'child_process';
import * as stream from 'stream';
import * as fs from 'fs';
import * as util from 'util';
import * as common from './common';
import * as log from './log';
import * as config from './config';
import ChannelItem from './ChannelItem';

interface User extends common.User {
    _stream?: stream.Writable;
}

interface Status {
    index: number;
    name: string;
    types: common.ChannelType[];
    command: string;
    pid: number;
    users: common.User[];
}

export default class TunerDevice extends events.EventEmitter {

    private _channel: ChannelItem = null;
    private _command: string = null;
    private _process: child_process.ChildProcess = null;
    private _stream: stream.Readable = null;

    private _users: User[] = [];

    private _isAvailable: boolean = true;
    private _exited: boolean = false;
    private _closing: boolean = false;

    constructor(private _index: number, private _config: config.Tuner) {
        super();
        log.debug('TunerDevice#%d initialized', this._index);
    }

    get index(): number {
        return this._index;
    }

    get config(): config.Tuner {
        return this._config;
    }

    get channel(): ChannelItem {
        return this._channel;
    }

    get command(): string {
        return this._command;
    }

    get pid(): number {
        return this._process ? this._process.pid : null;
    }

    get users(): User[] {
        return this._users.map(user => {
            return {
                id: user.id,
                priority: user.priority,
                agent: user.agent
            };
        });
    }

    get decoder(): string {
        return this._config.decoder || null;
    }

    get isAvailable(): boolean {
        return this._isAvailable;
    }

    get isFree(): boolean {
        return this._isAvailable === true && this._channel === null && this._users.length === 0;
    }

    get isUsing(): boolean {
        return this._isAvailable === true && this._channel !== null && this._users.length !== 0;
    }

    getPriority(): number {

        let priority = -2;

        for (let user of this._users) {
            if (user.priority > priority) {
                priority = user.priority;
            }
        }

        return priority;
    }

    export(): Status {
        return {
            index: this._index,
            name: this._config.name,
            types: this._config.types,
            command: this._command,
            pid: this.pid,
            users: this.users
        };
    }

    kill(): Promise<void> {
        return this._kill(true);
    }

    startStream(user: User, stream: stream.Writable, channel?: ChannelItem): Promise<void> {

        return new Promise<void>((resolve, reject) => {
            log.debug('TunerDevice#%d start stream for user `%s` (priority=%d)...', this._index, user.id, user.priority);

            if (this._isAvailable === false) {
                reject(new Error(util.format('TunerDevice#%d is not available', this._index)));
                return;
            }

            const streaming = () => {

                log.info('TunerDevice#%d streaming to user `%s` (priority=%d)', this._index, user.id, user.priority);

                user._stream = stream;
                this._users.push(user);

                stream.once('close', () => this.endStream(user));
            };

            if (typeof channel === 'undefined') {
                if (!this._stream) {
                    reject(new Error(util.format('TunerDevice#%d has not stream', this._index)));
                    return;
                } else {
                    streaming();
                    resolve();
                    return;
                }
            }

            if (this._config.types.indexOf(channel.type) === -1) {
                reject(new Error(util.format('TunerDevice#%d is not supported for channel type `%s`', this._index, channel.type)));
                return;
            }

            if (this._stream !== null) {
                if (channel.channel === this._channel.channel) {
                    streaming();
                    resolve();
                    return;
                } else if (user.priority <= this.getPriority()) {
                    reject(new Error(util.format('TunerDevice#%d has higher priority user', this._index)));
                    return;
                }

                resolve(this._kill(true)
                    .then(() => {
                        this._spawn(channel);
                        streaming()
                    }));
                return;
            } else {
                this._spawn(channel);
                streaming();
                resolve();
                return;
            }
        });
    }

    endStream(user: User): void {

        log.debug('TunerDevice#%d end stream for user `%s` (priority=%d)...', this._index, user.id, user.priority);

        let stream = null;

        this._users.some((_user, i) => {

            if (_user.id !== user.id || _user.priority !== user.priority) return false;

            _user._stream.end();
            this._users.splice(i, 1);
            stream = _user._stream;

            return true;
        });

        if (this._users.length === 0) {
            setTimeout(() => {
                if (this._users.length === 0 && this._process) {
                    this._kill(true)
                        .catch(log.error)
                        .then(() => {
                            stream.emit('final');
                        });
                }
            }, 1000);
        } else {
            stream.emit('final');
        }

        log.info('TunerDevice#%d end streaming to user `%s` (priority=%d)', this._index, user.id, user.priority);
    }

    private _spawn(ch): void {

        log.debug('TunerDevice#%d spawn...', this._index);

        if (this._process) {
            throw new Error(util.format('TunerDevice#%d has process', this._index));
        }

        let cmd = this._config.command;

        cmd = cmd.replace('<channel>', ch.channel);

        if (ch.satelite) {
            cmd = cmd.replace('<satelite>', ch.satelite);
        }

        this._process = child_process.spawn(cmd.split(' ')[0], cmd.split(' ').slice(1));
        this._command = cmd;
        this._channel = ch;

        if (typeof this._config.dvbDevicePath !== 'undefined') {
            const cat = child_process.spawn('cat', [this._config.dvbDevicePath]);

            cat.once('error', (err) => {

                log.error('TunerDevice#%d cat process error `%s` (pid=%d)', this._index, err.code, cat.pid);

                this._kill(false);
            });

            cat.once('close', (code, signal) => {

                log.debug(
                    'TunerDevice#%d cat process has closed with code=%d by signal `%s` (pid=%d)',
                    this._index, code, signal, cat.pid
                );

                if (this._exited === false) {
                    this._kill(false);
                }
            });

            this._process.once('exit', () => cat.kill('SIGKILL'));

            this._stream = cat.stdout;
        } else {
            this._stream = this._process.stdout;
        }

        this._process.once('exit', () => this._exited = true);

        this._process.once('error', (err) => {

            log.fatal('TunerDevice#%d process error `%s` (pid=%d)', this._index, err.code, this._process.pid);

            this._end();
            setTimeout(this._release.bind(this), this._config.dvbDevicePath ? 1000 : 100);
        });

        this._process.once('close', (code, signal) => {

            log.info(
                'TunerDevice#%d process has closed with exit code=%d by signal `%s` (pid=%d)',
                this._index, code, signal, this._process.pid
            );

            this._end();
            setTimeout(this._release.bind(this), this._config.dvbDevicePath ? 1000 : 100);
        });

        this._process.stderr.on('data', data => {
            log.info('TunerDevice#%d > %s', this._index, data.toString().trim());
        });

        // flowing start
        this._stream.on('data', this._streamOnData.bind(this));

        log.info('TunerDevice#%d process has spawned by command `%s` (pid=%d)', this._index, cmd, this._process.pid);
    }

    private _streamOnData(chunk: Buffer): void {

        for (let user of this._users) {
            user._stream.write(chunk);
        }
    }

    private _end(): void {

        this._isAvailable = false;

        this._stream.removeAllListeners('data');

        if (this._closing) {
            for (let user of this._users) {
                user._stream.end();
                user._stream.emit('final');
            }

            this._users.length = 0;
        }
    }

    private _kill(close: boolean): Promise<void> {

        return new Promise<void>((resolve, reject) => {

            log.debug('TunerDevice#%d kill...', this._index);

            if (!this._process || !this._process.pid) {
                reject(new Error(util.format('TunerDevice#%d has not process', this._index)));
                return;
            }

            this._isAvailable = false;
            this._closing = close;

            this.once('release', resolve);

            if (process.platform === 'win32') {
                const timer = setTimeout(() => this._process.kill(), 3000);
                this._process.once('exit', () => clearTimeout(timer));

                this._process.stdin.write('\n');
            } else {
                this._process.kill('SIGTERM');
            }
        });
    }

    private _release(): void {

        if (this._process) {
            this._process.stderr.removeAllListeners();
            this._process.removeAllListeners();
        }
        if (this._stream) {
            this._stream.removeAllListeners();
        }

        this._command = null;
        this._process = null;
        this._stream = null;

        if (this._closing) {
            this._channel = null;
            this._users = [];
        }

        this._isAvailable = true;
        this._closing = false;
        this._exited = false;

        this.emit('release');

        log.debug('TunerDevice#%d released', this._index);

        if (this._closing === false && this._users.length !== 0) {
            log.debug('TunerDevice#%d respawning because request has not closed', this._index);

            this._spawn(this._channel);
        }
    }
}