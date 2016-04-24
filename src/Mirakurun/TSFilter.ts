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
import epg from './epg';
import _ from './_';
import ServiceItem from './ServiceItem';
const aribts = require('aribts');
const CRC32_TABLE = require('../../node_modules/aribts/lib/crc32_table');

interface StreamOptions extends stream.DuplexOptions {
    networkId?: number;
    serviceId?: number;
    eventId?: number;
    noProvide?: boolean;
    parseSDT?: boolean;
    parseEIT?: boolean;
}

const PACKET_SIZE = 188;

const PROVIDE_PIDS = [
    0x0000,// PAT
    0x0001,// CAT
    0x0010,// NIT
    0x0011,// SDT
    0x0012,// EIT
    0x0013,// RST
    0x0014,// TDT
    0x0023,// SDTT
    0x0024,// BIT
    0x0028// SDTT
];

interface BasicExtState {
    basic: {
        flags: FlagState[];
        lastFlagsId: number;
    }
    extended: {
        flags: FlagState[];
        lastFlagsId: number;
    }
}

interface FlagState {
    flag: Buffer;
    ignore: Buffer;
    version_number: number;
}

export default class TSFilter extends stream.Duplex {

    // options
    private _provideServiceId: number;
    private _provideEventId: number;
    private _parseSDT: boolean = false;
    private _parseEIT: boolean = false;
    private _targetNetworkId: number;

    // aribts
    private _parser: stream.Transform = new aribts.TsStream();

    // buffer
    private _remain: Buffer = null;
    private _buffer: Buffer[] = [];
    private _parses: Buffer[] = [];
    private _patsec: Buffer = null;

    // state
    private _closed: boolean = false;
    private _ready: boolean = true;
    private _providePids: number[] = null;// `null` to provides all
    private _parsePids: number[] = [];
    private _tsid: number = -1;
    private _serviceIds: number[] = [];
    private _services: any[] = [];
    private _parseServiceIds: number[] = [];
    private _pmtPid: number = -1;
    private _pmtTimer: NodeJS.Timer;
    private _streamTime: number = null;
    private _epgReady: boolean = false;
    private _epgState: { [networkId: number]: { [serviceId: number]: BasicExtState } } = {};
    private _versions: Object = {};

    // stream options
    private highWaterMark: number = 1024 * 1024 * 16;

    // ReadableState in node/lib/_stream_readable.js
    private _readableState: any;

    constructor(options: StreamOptions) {
        super({
            allowHalfOpen: false
        });

        this._targetNetworkId = options.networkId || null;
        this._provideServiceId = options.serviceId || null;
        this._provideEventId = options.eventId || null;

        if (this._provideServiceId !== null) {
            this._providePids = [...PROVIDE_PIDS];
            this._ready = false;
        }
        if (this._provideEventId !== null) {
            this._ready = false;
        }
        if (options.noProvide === true) {
            this._provideServiceId = null;
            this._provideEventId = null;
            this._providePids = [];
            this._ready = false;
        }
        if (options.parseSDT === true) {
            this._parseSDT = true;
        }
        if (options.parseEIT === true) {
            if (this._targetNetworkId === null) {
                this._parseEIT = true;
            } else if (epg.status[this._targetNetworkId] !== true) {
                epg.status[this._targetNetworkId] = true;
                this._parseEIT = true;
            }
        }

        this._parser.resume();
        this._parser.on('pat', this._onPAT.bind(this));
        this._parser.on('pmt', this._onPMT.bind(this));
        this._parser.on('sdt', this._onSDT.bind(this));
        this._parser.on('eit', this._onEIT.bind(this));
        this._parser.on('tot', this._onTOT.bind(this));

        this.once('finish', this._close.bind(this));
        this.once('close', this._close.bind(this));

        log.debug('TSFilter has created (serviceId=%s, eventId=%s)', this._provideServiceId, this._provideEventId);

        if (this._ready === false) {
            log.debug('TSFilter is waiting for serviceId=%s, eventId=%s', this._provideServiceId, this._provideEventId);
        }
    }

    _read(size: number) {

        if (this._closed === true) {
            this.push(null);
        }
    }

    _write(chunk: Buffer, encoding, callback: Function) {

        if (this._closed === true) {
            callback(new Error('TSFilter has closed already'));
            return;
        }

        // stringent safety measure
        if (this._readableState.length > this.highWaterMark) {
            log.error('TSFilter is closing because overflowing the buffer...');
            this._close();
            return;
        }

        let i = 0;

        if (this._remain !== null) {
            if (chunk.length >= PACKET_SIZE - this._remain.length) {
                this._processPacket(Buffer.concat([this._remain, chunk.slice(0, PACKET_SIZE - this._remain.length)]));
                i = PACKET_SIZE - this._remain.length;
            } else {
                this._remain = Buffer.concat([this._remain, chunk]);

                // chunk drained
                callback();
                return;
            }
        }

        // find sync_byte
        for (; chunk.length - i >= PACKET_SIZE; i += PACKET_SIZE) {
            if (chunk[0] !== 0x47 && (i = chunk.indexOf(0x47, i)) === -1) break;

            this._processPacket(chunk.slice(i, i + PACKET_SIZE));
        }

        this._remain = i !== -1 ? chunk.slice(i) : null;

        if (this._buffer.length !== 0) {
            this.push(Buffer.concat(this._buffer));
            this._buffer.length = 0;
        }

        if (this._parses.length !== 0) {
            this._parser.write(Buffer.concat(this._parses));
            this._parses.length = 0;
        }

        callback();
    }

    private _processPacket(packet: Buffer): void {

        const pid = packet.readUInt16BE(1) & 0x1FFF;

        // ignore NULL packet (pid = 0x1FFF)
        if (pid === 0x1FFF) {
            return;
        }

        // parse packet
        if (pid === 0) {
            this._parser.write(packet);
        } else if ((pid === 0x12 && (this._parseEIT || this._provideEventId !== null)) || pid === 0x14 || this._parsePids.indexOf(pid) !== -1) {
            this._parses.push(packet);
        }

        // rewrite packet
        if (pid === 0) {
            if (this._patsec !== null) {
                const pat = new Buffer(packet);

                this._patsec.copy(pat, 5, 0);
                pat.fill(0xFF, 5 + this._patsec.length);

                packet = pat;
            } else {
                packet = null;
            }
        }

        if (this._ready === false) {
            return;
        }
        if (this._providePids !== null && this._providePids.indexOf(pid) === -1) {
            return;
        }
        if (packet === null) {
            return;
        }

        this._buffer.push(packet);
    }

    private _onPAT(pid, data): void {

        if (this._versions.hasOwnProperty(pid) && data.version_number === this._versions[pid]) {
            return;
        }

        this._tsid = data.transport_stream_id;
        this._serviceIds = [];
        this._parseServiceIds = [];

        for (let program of data.programs) {
            if (program.program_number === 0) {
                log.debug('TSFilter detected NIT PID=%d', program.network_PID);
                continue;
            }

            this._serviceIds.push(program.program_number);

            let item: ServiceItem = null;

            if (this._targetNetworkId !== null) {
                item = _.service.get(this._targetNetworkId, program.program_number);
            }

            log.debug(
                'TSFilter detected PMT PID=%d as serviceId=%d (%s)',
                program.program_map_PID, program.program_number, item !== null ? item.name : 'unregistered'
            );

            // detect PMT PID by specific service id
            if (this._provideServiceId === program.program_number) {
                if (this._pmtPid !== program.program_map_PID) {
                    this._pmtPid = program.program_map_PID;

                    if (this._providePids.indexOf(this._pmtPid) === -1) {
                        this._providePids.push(this._pmtPid);
                    }
                    if (this._parsePids.indexOf(this._pmtPid) === -1) {
                        this._parsePids.push(this._pmtPid);
                    }

                    // reset PAT section
                    this._patsec = new Buffer(20);

                    // edit PAT section
                    data._raw.copy(this._patsec, 0, 0, 8);

                    // section_length
                    this._patsec[2] = 17;// 0x11

                    // network_number = 0
                    this._patsec[8] = 0;
                    this._patsec[9] = 0;
                    // network_PID
                    this._patsec[10] = 224;
                    this._patsec[11] = 16;

                    // program_number
                    this._patsec[12] = program.program_number >> 8;
                    this._patsec[13] = program.program_number & 255;
                    // program_map_PID
                    this._patsec[14] = (this._pmtPid >> 8) + 224;
                    this._patsec[15] = this._pmtPid & 255

                    // calculate CRC32
                    this._patsec.writeInt32BE(TSFilter.calcCRC32(this._patsec.slice(0, 16)), 16);
                }
            }

            if (this._parseEIT === true && item !== null) {
                _.service.findByNetworkId(this._targetNetworkId).forEach(service => {
                    if (this._parseServiceIds.indexOf(service.serviceId) === -1) {
                        this._parseServiceIds.push(service.serviceId);

                        log.debug('TSFilter parsing serviceId=%d (%s)', service.serviceId, service.name);
                    }
                });
            }
        }

        if (this._parseSDT === true) {
            if (this._parsePids.indexOf(0x11) === -1) {
                this._parsePids.push(0x11);
            }
        }

        this._versions[pid] = data.version_number;
    }

    private _onPMT(pid, data): void {

        if (this._versions.hasOwnProperty(pid) && data.version_number === this._versions[pid]) {
            return;
        }

        if (this._ready === false && this._provideServiceId !== null && this._provideEventId === null) {
            this._ready = true;

            log.debug('TSFilter is now ready for serviceId=%d', this._provideServiceId);
        }

        if (this._providePids.indexOf(data.program_info[0].CA_PID) === -1) {
            this._providePids.push(data.program_info[0].CA_PID);
        }

        if (this._providePids.indexOf(data.PCR_PID) === -1) {
            this._providePids.push(data.PCR_PID);
        }

        for (let stream of data.streams) {
            if (this._providePids.indexOf(stream.elementary_PID) === -1) {
                this._providePids.push(stream.elementary_PID);
            }
        }

        this._versions[pid] = data.version_number;
    }

    private _onSDT(pid, data): void {

        if (this._versions.hasOwnProperty(pid) && data.version_number === this._versions[pid]) {
            return;
        }

        if (this._tsid !== data.transport_stream_id) {
            return;
        }

        for (let service of data.services) {
            if (this._serviceIds.indexOf(service.service_id) === -1) {
                continue;
            }

            let desc = service.descriptors.find(descriptor => descriptor.descriptor_tag === 0x48);
            let name = desc !== void 0 ? new aribts.TsChar(desc.service_name_char).decode() : '';

            if (!this._services.some(_service => _service.id === service.service_id)) {
                this._services.push({
                    networkId: data.original_network_id,
                    serviceId: service.service_id,
                    name: name
                });
            }
        }

        process.nextTick(() => this.emit('services', this._services));

        let index = this._parsePids.indexOf(pid);
        if (index !== -1) {
            this._parsePids.splice(index, 1);
        }

        this._versions[pid] = data.version_number;
    }

    private _onEIT(pid, data): void {

        if (this._parseServiceIds.indexOf(data.service_id) === -1) {
            return;
        }

        // detect current event
        if (
            data.events.length !== 0 &&
            this._provideEventId !== null && data.table_id === 0x4E && data.section_number === 0 &&
            (this._provideServiceId === null || this._provideServiceId === data.service_id)
        ) {
            if (data.events[0].event_id === this._provideEventId) {
                if (this._ready === false) {
                    this._ready = true;

                    log.debug('TSFilter is now ready for eventId=%d', this._provideEventId);
                }
            } else {
                if (this._ready === true) {
                    this._ready = false;

                    log.debug('TSFilter is closing because eventId=%d has ended...', this._provideEventId);

                    process.nextTick(() => this.emit('close'));
                    return;
                }
            }
        }

        // write EPG stream and store result
        if (this._parseEIT === true && data.table_id !== 0x4E && data.table_id !== 0x4F) {
            epg.write(data);

            if (this._epgReady === false) {
                this._updateEpgState(data);
            }
        }
    }

    private _onTOT(pid, data): void {
        this._streamTime = TSFilter.getTime(data.JST_time);
    }

    private _updateEpgState(data): void {

        const networkId = data.original_network_id;
        const serviceId = data.service_id;

        if (this._epgState[networkId] === void 0) {
            this._epgState[networkId] = {};
        }

        if (this._epgState[networkId][serviceId] === void 0) {
            this._epgState[networkId][serviceId] = {
                basic: {
                    flags: [],
                    lastFlagsId: -1,
                },
                extended: {
                    flags: [],
                    lastFlagsId: -1,
                }
            };

            for (let i = 0; i < 0x08; i++) {
                [this._epgState[networkId][serviceId].basic, this._epgState[networkId][serviceId].extended].forEach(target => {
                    target.flags.push({
                        flag: new Buffer(32).fill(0x00),
                        ignore: new Buffer(32).fill(0xFF),
                        version_number: -1
                    });
                });
            }
        }

        const flagsId = data.table_id & 0x07;
        const lastFlagsId = data.last_table_id & 0x07;
        const segmentNumber = data.section_number >> 3;
        const lastSegmentNumber = data.last_section_number >> 3;
        const sectionNumber = data.section_number & 0x07;
        const segmentLastSectionNumber = data.segment_last_section_number & 0x07;
        const targetFlags = (data.table_id & 0x0F) < 0x08 ? this._epgState[networkId][serviceId].basic : this._epgState[networkId][serviceId].extended;

        if ((targetFlags.lastFlagsId !== lastFlagsId) ||
            (targetFlags.flags[flagsId].version_number !== -1 && targetFlags.flags[flagsId].version_number !== data.version_number)) {
            // reset fields
            for (let i = 0; i < 0x08; i++) {
                targetFlags.flags[i].flag.fill(0x00);
                targetFlags.flags[i].ignore.fill(i <= lastFlagsId ? 0x00 : 0xFF);
            }
        }

        // update ignore field (past segment)
        if (flagsId === 0 && this._streamTime !== null) {
            let segment = (this._streamTime + 9 * 60 * 60 * 1000) / (3 * 60 * 60 * 1000) & 0x07;

            for (let i = 0; i < segment; i++) {
                targetFlags.flags[flagsId].ignore[i] = 0xFF;
            }
        }

        // update ignore field (segment)
        for (let i = lastSegmentNumber + 1; i < 0x20 ; i++) {
            targetFlags.flags[flagsId].ignore[i] = 0xFF;
        }

        // update ignore field (section)
        for (let i = segmentLastSectionNumber + 1; i < 8; i++) {
            targetFlags.flags[flagsId].ignore[segmentNumber] |= 1 << i;
        }

        // update flag field
        targetFlags.flags[flagsId].flag[segmentNumber] |= 1 << sectionNumber;

        // update last_table_id & version_number
        targetFlags.lastFlagsId = lastFlagsId;
        targetFlags.flags[flagsId].version_number = data.version_number;

        this._epgReady = Object.keys(this._epgState).every(nid => {
            return Object.keys(this._epgState[nid]).every(sid => {
                return [this._epgState[nid][sid].basic, this._epgState[nid][sid].extended].every(target => {
                    return target.flags.every(table => {
                        return table.flag.every((segment, i) => {
                            return (segment | table.ignore[i]) === 0xFF;
                        });
                    });
                });
            });
        });

        if (this._epgReady === true) {
            process.nextTick(() => this.emit("epgReady"));
        }
    }

    private _close(): void {

        if (this._closed) {
            return;
        }

        this._closed = true;

        // clear timer
        clearTimeout(this._pmtTimer);

        // clear buffer
        process.nextTick(() => {
            this._readableState.buffer = [];
            this._readableState.length = 0;
            this._patsec = null;
            this._remain = null;
        });

        // clear instance
        this._parser.removeAllListeners();
        this._parser.end();
        this._parser = null;

        // update status
        if (this._parseEIT === true && this._targetNetworkId !== null) {
            epg.status[this._targetNetworkId] = false;
        }

        this.emit('close');

        log.debug('TSFilter has closed (serviceId=%s, eventId=%s)', this._provideServiceId, this._provideEventId);
    }

    static calcCRC32(buf: Buffer): number {

        let i = 0, l = buf.length, crc = -1;
        for (; i < l; i++) {
            crc = (crc << 8) ^ CRC32_TABLE[((crc >>> 24) ^ buf[i])];
        }
        return crc;
    }

    static getTime(buffer: Buffer): number {

        let mjd = (buffer[0] << 8) | buffer[1];

        let y = (((mjd - 15078.2) / 365.25) | 0);
        let m = (((mjd - 14956.1 - ((y * 365.25) | 0)) / 30.6001) | 0);
        let d = mjd - 14956 - ((y * 365.25) | 0) - ((m * 30.6001) | 0);

        let k = (m === 14 || m === 15) ? 1 : 0;

        y = y + k + 1900;
        m = m - 1 - k * 12;

        let h = (buffer[2] >> 4) * 10 + (buffer[2] & 0x0F);
        let i = (buffer[3] >> 4) * 10 + (buffer[3] & 0x0F);
        let s = (buffer[4] >> 4) * 10 + (buffer[4] & 0x0F);

        return new Date(y, m - 1, d, h, i, s).getTime();
    }
}