const EventEmitter = require('events')
const ApiWrapper = require('./api-wrapper.js')
const Logger = require('../helpers/logger.js')
var fs = require('fs')
var vscode = require('vscode')
const Config = require('../config.js')
const Utils = require('../helpers/utils.js')
const PySerial = require('../connections/pyserial')
const {workspace} = require('vscode')
const dns = require('dns')

module.exports = class SettingsWrapper extends EventEmitter {
  constructor(cb) {
    super()
    this.config = Config.settings
    this.constants = Config.constants
    this.project_config = {}
    this.api = new ApiWrapper(this)
    this.project_path = this.api.getProjectPath()
    this.global_config_file = Utils.getConfigPath('pymakr.json')
    this.config_file = this.project_path + '/pymakr.conf'
    this.json_valid = true
    this.logger = new Logger('SettingsWrapper')
    this.utils = new Utils(this)
    this.project_change_callbacks = []
    this.global_config = {}
    this.watching = {}
    this.file_watcher = {}
    this.change_watcher = {}
    this.file_changed = {}
    this.setFileChangedGlobal()
    var _this = this

    this.readConfigFile(this.global_config_file, true, function (contents) {
      _this.global_config = contents
      _this.readConfigFile(_this.config_file, false, function (contents) {
        _this.project_config = contents
        _this.refresh(function () {
          _this.watchConfigFile()
          _this.watchConfigFile(_this.config_file)
          _this.watchProjectChange()
          _this.upload_chunk_size = _this.get_upload_chunk_size()
          if (cb) {
            cb(_this)
            cb = null
          }
        })
      })
    })
  }

  setFileChangedGlobal() {
    this.file_changed[this.config_file] = true
    this.file_changed[this.global_config_file] = true
  }
  onChange(key, cb) {
    this.change_watcher[key] = cb
  }

  projectChanged() {
    this.getProjectPath()
    this.refreshProjectConfig()
    this.watchConfigFile(this.config_file)
  }

  getProjectPath() {
    this.project_path = this.api.getProjectPath()
    this.config_file = this.project_path + '/pymakr.conf'
    return this.project_path
  }

  registerProjectChangeWatcher(cb) {
    this.project_change_callbacks.push(cb)
  }

  watchProjectChange() {
    var _this = this
    this.api.onProjectsChange(function (paths) {
      _this.refreshProjectConfig()
      for (var i = 0; i < _this.project_change_callbacks.length; i++) {
        _this.project_change_callbacks[i](_this.project_path)
      }
    })
  }

  get_upload_chunk_size() {
    var size = this.constants.upload_batch_size
    if (this.fast_upload) {
      size = size * this.constants.fast_upload_batch_multiplier
    }
    return size
  }

  watchConfigFile(file) {
    if (!file) {
      file = this.global_config_file
    }

    this.logger.info('Watching config file ' + file)
    var _this = this
    if (this.file_watcher[file]) {
      this.file_watcher[file].close()
    }
    fs.open(file, 'r', function (err, content) {
      if (!err) {
        _this.file_watcher[file] = fs.watch(file, null, function (err) {
          _this.logger.info('Config file changed, refreshing settings')
          _this.file_changed[file] = true
          // give it some time to close
          setTimeout(function () {
            _this.refresh()
          }, 150)
        })
      } else {
        _this.logger.warning('Error opening config file ')
        _this.logger.warning(err)
      }
    })
  }

  refresh(cb) {
    var _this = this
    this.refreshGlobalConfig(function () {
      _this.refreshProjectConfig()
      if (cb) cb()
    })
  }
  refreshGlobalConfig(cbg) {
    var _this = this

    this.logger.info('Refreshing global config')
    try {
      var contents = this.readConfigFileSync(this.global_config_file)
      this.global_config = contents
    } catch (e) {
      this.emit('format_error')
      cbg(e)
      cbg = null
      return
    }

    this.trigger_global_change_watchers()

    this.address = this.api.config('address')
    this.username = this.api.config('username')
    this.password = this.api.config('password')
    this.sync_folder = this.api.config('sync_folder')
    this.sync_file_types = this.api.config('sync_file_types')
    this.sync_all_file_types = this.api.config('sync_all_file_types')

    this.ctrl_c_on_connect = this.api.config('ctrl_c_on_connect')
    this.open_on_start = this.api.config('open_on_start')
    this.safe_boot_on_upload = this.api.config('safe_boot_on_upload')
    this.statusbar_buttons = this.api.config('statusbar_buttons')
    this.reboot_after_upload = this.api.config('reboot_after_upload')

    this.auto_connect = this.api.config('auto_connect')
    this.py_ignore = this.api.config('py_ignore')
    this.fast_upload = this.api.config('fast_upload')
    this.autoconnect_comport_manufacturers = this.api.config('autoconnect_comport_manufacturers')

    this.timeout = 15000
    this.setProjectConfig()

    if (this.statusbar_buttons == undefined || this.statusbar_buttons == '') {
      this.statusbar_buttons = ['status', 'connect', 'upload', 'download', 'run']
    }
    this.statusbar_buttons.push('global_settings')
    this.statusbar_buttons.push('project_settings')

    if (!this.py_ignore) {
      this.py_ignore = []
      this.py_ignore.push(this.constants.compressed_files_folder)
    }

    PySerial.isSerialPort(this.address, function (is_serial) {
      if (is_serial || _this.utils.isIP(_this.address)) {
        if (cbg) cbg()
      } else if (!_this.auto_connect) {
        // If content is no IP or com, it might be a domain name
        // Try to look up the IP and overwrite self.address
        dns.lookup(_this.api.config('address'), (err, address, family) => {
          _this.logger.info('Found dns lookup address: ' + address)
          if (address && address.indexOf('.') > -1) {
            _this.address = address
          }
          if (cbg) cbg()
        })
      } else {
        if (cbg) cbg()
      }
    })
  }

  trigger_global_change_watchers() {
    for (const k of Object.keys(this.config)) {
      if (this.api.config(k) != this[k] && this.change_watcher[k]) {
        var old = this[k]
        this[k] = this.api.config(k)
        this.change_watcher[k](old, this.api.config(k))
      }
    }
  }

  get_allowed_file_types() {
    return Utils.coerceArray(this.sync_file_types, ',')
  }

  checkConfigComplete(path, contents, cb) {
    if (!this.isConfigComplete(contents)) {
      const defaults = this.getDefaultGlobalConfig()
      contents = Object.assign({}, defaults, contents)
      var json_string = JSON.stringify(contents, null, '\t')

      fs.writeFile(path, json_string, cb)
      return json_string
    } cb()
    
  }

  readConfigFileSync(path) {
    var contents = {}
    try {
      contents = fs.readFileSync(path, {encoding: 'utf-8'})
      contents = JSON.parse(contents)
    } catch (e) {
      this.logger.warning('Error processing Config file:' + path)
      if (e instanceof SyntaxError && this.file_changed[path]) {
        this.emit('format_error.project')
        this.file_changed[path] = false
      }
      contents = {}
    }
    return contents
  }

  readConfigFile(path, check_complete, cb) {
    var _this = this
    fs.readFile(path, function (err, contents) {
      if (!err) {
        try {
          contents = JSON.parse(contents)
          if (check_complete) {
            _this.checkConfigComplete(path, contents, function () {
              _this.watchConfigFile(path)
              if (cb) {
                cb(contents)
              }
            })
          } else if (cb) {
            cb(contents)
          }
        } catch (e) {
          console.log(e)
          cb({})
          // config file not properly formatted. TODO: throw error?
        }
      } else {
        cb({})
      }
    })
  }

  refreshProjectConfig() {
    this.logger.info('Refreshing project config')
    var _this = this
    this.project_config = {}
    this.project_path = this.api.getProjectPath()
    this.config_file = this.project_path + '/pymakr.conf'

    try {
      var contents = this.readConfigFileSync(this.config_file)
      if (contents) {
        this.logger.silly('Found contents')
        this.project_config = contents
        _this.setProjectConfig()
      }
    } catch (e) {
      _this.logger.info('No project config present')
      return null
    }
  }

  setProjectConfig() {
    Object.assign(this, this.project_config)
  }

  isConfigComplete(settings_object) {
    return Object.keys(settings_object).length >= Object.keys(this.getDefaultGlobalConfig()).length
  }

  getDefaultProjectConfig() {
    return this.__getDefaultConfig(false)
  }

  getDefaultGlobalConfig() {
    return this.__getDefaultConfig(true)
  }

  __getDefaultConfig(global = false) {
    var config = {
      address: this.api.config('address'),
      username: this.api.config('username'),
      password: this.api.config('password'),
      sync_folder: this.api.config('sync_folder'),
      open_on_start: this.api.config('open_on_start'),
      safe_boot_on_upload: this.api.config('safe_boot_on_upload'),
      statusbar_buttons: this.api.config('statusbar_buttons'),
      py_ignore: this.api.config('py_ignore'),
      fast_upload: this.api.config('fast_upload'),
    }
    if (global) {
      config.sync_file_types = this.api.config('sync_file_types')
      config.ctrl_c_on_connect = this.api.config('ctrl_c_on_connect')
      config.sync_all_file_types = this.api.config('sync_all_file_types')
      config.auto_connect = this.api.config('auto_connect')
      config.autoconnect_comport_manufacturers = this.api.config(
        'autoconnect_comport_manufacturers'
      )
    }
    return config
  }

  openProjectSettings(cb) {
    var _this = this
    if (this.getProjectPath()) {
      var config_file = this.config_file
      fs.open(config_file, 'r', function (err, contents) {
        if (err) {
          var json_string = _this.newProjectSettingsJson()
          fs.writeFile(config_file, json_string, function (err) {
            if (err) {
              cb(new Error(err))
              return
            }
            _this.watchConfigFile(config_file)
            var uri = vscode.Uri.file(config_file)
            workspace.openTextDocument(uri).then(function (textDoc) {
              vscode.window.showTextDocument(textDoc)
              cb()
            })
          })
        } else {
          var uri = vscode.Uri.file(config_file)
          workspace.openTextDocument(uri).then(function (textDoc) {
            vscode.window.showTextDocument(textDoc)
            cb()
          })
        }
      })
    } else {
      cb(new Error('No project open'))
    }
  }

  openSettingsFile(filename, cb) {
    var _this = this
    var exists = fs.existsSync(filename)
    if (!exists) {
      var json_string = _this.newProjectSettingsJson()
      _this.createSettingsFile(filename, json_string, function () {
        _this.api.openFile(filename, cb)
      })
    } else {
      _this.api.openFile(filename, cb)
    }
  }

  createSettingsFile(filename, contents, cb, open = false) {
    var _this = this
    fs.writeFile(filename, contents, function (err) {
      if (err) {
        cb(new Error(err))
        return
      }
      _this.watchConfigFile(filename)
      if (open) {
        _this.api.openFile(filename, cb)
      } else {
        cb()
      }
    })
  }

  newProjectSettingsJson() {
    var settings = this.getDefaultProjectConfig()
    var json_string = JSON.stringify(settings, null, 4)
    return json_string
  }
}
