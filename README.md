[![Mirakurun](https://yabumi.cc/153eab7d76cd45beb272b916.svg)](https://github.com/kanreisa/Mirakurun)

# Mirakurun

DVR Tuner Server Service for **[Chinachu](https://chinachu.moe/)** Air.

[![npm version][npm-img]][npm-url]
[![Linux Build][travis-img]][travis-url]
[![Dependency Status][dep-img]][dep-url]
[![devDependency Status][devdep-img]][devdep-url]

## Features

* RESTful API - has designed like HTTP version of Spinel
* Unix Sockets / TCP
* Advanced Tuner Process Management
* Priority Management
* Integrated MPEG-2 TS Parser, Filter
* Realtime EPG Parser
* Supports most Tuner Devices (chardev, DVB / ISDB-T, ISDB-S, DVB-S2)

## Requirements / Supported Platforms

* [Node.js](http://nodejs.org/) `>=5.9.0`

**Bold** is the recommended.
see: [doc/Platforms.md](doc/Platforms.md)

### **Linux**

* [PM2](http://pm2.keymetrics.io/) `>=1.0.2`
* x86 / **x64** / ARMv7 / **ARMv8**
* **Debian** / Ubuntu / CentOS / Gentoo
* SystemV / OpenRC / **SystemD**

### Darwin (Experimental)

* [PM2](http://pm2.keymetrics.io/) `>=1.0.2`
* OS X v10.11 El Capitan

### Win32 (Experimental)

* [winser](https://github.com/jfromaniello/winser) `>=1.0.2`
* Windows 10 TH2

## Install

```
# Linux / Darwin
sudo npm install pm2 -g
sudo npm install mirakurun -g --unsafe --production

# Win32 (Windows PowerShell as Admin)
npm install winser -g
npm install mirakurun -g --production
```

### Update

```
# Linux / Darwin
sudo npm install mirakurun@latest -g --unsafe --production

# Win32 (Windows PowerShell as Admin)
npm install mirakurun@latest -g --production
```

### Uninstall

```
# Linux / Darwin
sudo npm uninstall mirakurun -g --unsafe

# Win32 (Windows PowerShell as Admin)
npm uninstall mirakurun -g
```

## CLI

**Only Linux / Darwin Platform**

### Administration

#### Config

```
mirakurun config [server|tuners|channels]
```
Typically, don't need edit this.

* Also you can config on Chinachu Web App.
* see: [doc/Configuration.md](doc/Configuration.md)

#### Log Stream

```
mirakurun log server
```

#### Service Management

```
mirakurun [status|start|stop|restart]
```

## Client Implementations

* [Rivarun](https://github.com/kanreisa/Rivarun)
* [BonDriver_Mirakurun](https://github.com/h-mineta/BonDriver_Mirakurun)

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md)

## Slack Community

* Join: https://slack.chinachu.moe/
* Login: https://chinachu.slack.com/

## License

[Apache License, Version 2.0](LICENSE)

**Commercial License/Support** is provided by [Pixely LLC](https://pixely.jp/).

[npm-img]: https://img.shields.io/npm/v/mirakurun.svg
[npm-url]: https://npmjs.org/package/mirakurun
[travis-img]: https://img.shields.io/travis/kanreisa/Mirakurun.svg
[travis-url]: https://travis-ci.org/kanreisa/Mirakurun
[dep-img]: https://david-dm.org/kanreisa/Mirakurun.svg
[dep-url]: https://david-dm.org/kanreisa/Mirakurun
[devdep-img]: https://david-dm.org/kanreisa/Mirakurun/dev-status.svg
[devdep-url]: https://david-dm.org/kanreisa/Mirakurun#info=devDependencies