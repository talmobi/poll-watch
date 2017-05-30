var fs = require('fs')
var path = require('path')

// TODO (filters?)
var _opts = {}

var _mtimes = {} // file mtimes
var _files = {} // files being watched
var _intervals = {} // variable polling intervals
var _timeouts = {} // polling setTimeouts

var _touched = {} // touched files (from start of process)

var _watchers = {}
var _textContents = {} // TODO

var HOT_FILE = (1000 * 60 * 5) // 5 minutes in ms
var SEMI_HOT_FILE = (1000 * 60 * 15) // 15 minutes in ms
var WARM_FILE = (1000 * 60 * 60) // 60 minutes in ms
var COLD_FILE = (1000 * 60 * 60 * 3) // 3 hours in ms

var INITIAL_FILE = (1000 * 60 * 1) // 1 minute in ms

var HOT_POLL_INTERVAL = 33
var SEMI_HOT_POLL_INTERVAL = 99
var WARM_POLL_INTERVAL = 200
var COLD_POLL_INTERVAL = 500
var FREEZING_POLL_INTERVAL = 800

var _errors = {}

var _startTime

var _enoents = {}
var MAX_ENOENTS = 25

var INFO = {
  STATE_CHANGE: false,
  INITIAL: false,
  FIRST_MODIFICATION: false,
  WARNING: false,
  WATCHING: false
}

function poll (filepath) {
  var _mtime = _mtimes[filepath]

  fs.stat(filepath, function (err, stats) {
    if (err) {
      // increment error counter
      _errors[filepath] = (_errors[filepath] || 0) + 1

      switch (err.code) {
        case 'ENOENT':
          // file doesn't exist - probably locked/being modified at the moment
          // so we will try again very soon; therefore this is not a very serious error.
          // However, we will keep track of ENOENT errors and fail when MAX_ENOENTS
          // is reached.
          _enoents[filepath] = (_enoents[filepath] || 0) + 1 // increment
          if (_enoents[filepath] < MAX_ENOENTS) { // retry very soon
            // console.log('ENOENT retry: ' + _enoents[filepath])
            clearTimeout(_timeouts[filepath])
            _timeouts[filepath] = setTimeout(function () {
              poll(filepath)
            }, 5)
          } else {
            throw new Error('Error! Max ENOENT retries: ' + _enoents[filepath])
          }
          break
        default:
          throw err
      }
    } else { // no errors
      _enoents[filepath] = 0 // successful read, clear ENOENT counter

      if (_mtime === undefined) {
        // initial poll
        INFO.INITIAL && console.log('initial poll')
        _mtimes[filepath] = stats.mtime
      } else {
        if (stats.mtime > _mtime) { // file has been modified
          if (!_touched[filepath]) {
            _touched[filepath] = true
            INFO.FIRST_MODIFICATION && console.log('first modification')
          }
          _watchers[filepath].emit() // trigger callbacks/listeners
          _mtimes[filepath] = stats.mtime
        }
      }


      var delta

      // slow down or speed up the polling based on how actively
      // the file being watched is being modified
      delta = Date.now() - stats.mtime

      // special case when file has never been touched since the start
      if (!_touched[filepath]) {
        delta = Date.now() - _startTime
        if (delta < INITIAL_FILE) {
          if (_intervals[filepath] !== SEMI_HOT_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('(untouched) SEMI HOT FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = SEMI_HOT_POLL_INTERVAL
          }
        } else if (delta < WARM_FILE) {
          if (_intervals[filepath] !== WARM_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('(untouched) WARM FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = WARM_POLL_INTERVAL
          }
        } else if (delta < COLD_FILE) {
          if (_intervals[filepath] !== COLD_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('(untouched) COLD FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = COLD_POLL_INTERVAL
          }
        } else {
          if (_intervals[filepath] !== FREEZING_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('(untouched) FREEZING FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = FREEZING_POLL_INTERVAL
          }
        }
      } else {
        if (delta < HOT_FILE) {
          if (_intervals[filepath] !== HOT_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('HOT FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = HOT_POLL_INTERVAL
          }
        } else if (delta < SEMI_HOT_FILE) {
          if (_intervals[filepath] !== SEMI_HOT_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('SEMI HOT FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = SEMI_HOT_POLL_INTERVAL
          }
        } else if (delta < WARM_FILE) {
          if (_intervals[filepath] !== WARM_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('WARM FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = WARM_POLL_INTERVAL
          }
        } else if (delta < COLD_FILE) {
          if (_intervals[filepath] !== COLD_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('COLD FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = COLD_POLL_INTERVAL
          }
        } else {
          if (_intervals[filepath] !== FREEZING_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('FREEZING FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = FREEZING_POLL_INTERVAL
          }
        }
      }

      // schedule next poll
      clearTimeout(_timeouts[filepath])
      _timeouts[filepath] = setTimeout(function () {
        poll(filepath)
      }, _intervals[filepath])
    } // else
  }) // fs.stat
}

function startPolling (filepath) {
  if (!_startTime) _startTime = Date.now()

  if (_timeouts[filepath] !== undefined) {
    throw new Error('Error! File is already being watched/polled.')
  }
  _mtimes[filepath] = undefined
  _intervals[filepath] = 300
  _timeouts[filepath] = setTimeout(function () {
    poll(filepath)
  }, _intervals[filepath])
}

function createPathWatcher (filepath) {
  var _listeners = []
  var _mtime
  var _last_mtime

  function on (callback) {
    if (_listeners.length === 0) {
      resume()
    }

    _listeners.push(callback)
    return function off () { // return off/unsubscribe function
      var i = _listeners.indexOf(callback)
      _listeners.splice(i, 1)
      if (_listeners.length === 0) {
        halt()
      }
    }
  }

  function emit () {
    _listeners.forEach(function (callback) {
      callback({
        path: filepath,
        mtime: _mtimes[filepath],
        last_mtime: _last_mtime
      })
    })

    _last_mtime = _mtimes[filepath]
  }

  function halt () {
    clearTimeout(_timeouts[filepath])
  }

  function resume () {
    clearTimeout(_timeouts[filepath])
    _timeouts[filepath] = setTimeout(function () {
      poll(filepath)
    }, 5)
  }

  function close () {
    delete _files[filepath]
    delete _mtimes[filepath]
    clearTimeout(_timeouts[filepath])
    delete _timeouts[filepath]
    delete _intervals[filepath]
  }

  return {
    on: on,
    emit: emit,
    clear: function () {
      _listeners = []
    },
    close: close
  }
}

var _recentWarningCount = 0
var _recentWarningTimeout
function watch (filepath) {
  filepath = path.resolve(filepath) // resolve path
  // remove trailling path separators
  while (filepath[filepath.length - 1] === path.sep) filepath = filepath.slice(0, -1)

  // make sure file isn't already being watched
  if (_watchers[filepath] === undefined) {
    _watchers[filepath] = createPathWatcher(filepath)
    // _watchers[filepath].close = function () {
    //   delete _files[filepath]
    //   delete _mtimes[filepath]
    //   clearTimeout(_timeouts[filepath])
    //   delete _timeouts[filepath]
    //   delete _intervals[filepath]
    // }

    _files[filepath] = Date.now()

    if (/node_modules|^\.|[\/\\]\./i.test(filepath)) {
      // console.log('warning: skipping node_modules or dotfile')
      _recentWarningCount++
    } else {
      if (_recentWarningCount > 0) {
        INFO.WARNING && console.log('warning: skipping node_modules or dotfile, [' + _recentWarningCount + '] times')
        _recentWarningCount = 0
      }
      INFO.WATCHING && console.log('  \u001b[90mwatching\u001b[0m $fp'.replace('$fp', filepath))
      startPolling(filepath)
    }
  } else { // TODO
    if (/node_modules|^\.|[\/\\]\./i.test(filepath)) {
      _recentWarningCount++
    } else {
      if (_recentWarningCount > 0) {
        INFO.WARNING && console.log('warning: skipping node_modules or dotfile, [' + _recentWarningCount + '] times')
        _recentWarningCount = 0
      }
      INFO.WARNING && console.log('warning: $fp already being watched.'.replace('$fp', filepath))
    }
  }

  clearTimeout(_recentWarningTimeout)
  _recentWarningTimeout = setTimeout(function () {
    if (_recentWarningCount > 0) {
      INFO.WARNING && console.log('warning: skipping node_modules or dotfile, [' + _recentWarningCount + '] times')
      _recentWarningCount = 0
    }
  }, 0)

  return _watchers[filepath]
}

function clear () {
  Object.keys(_timeouts).forEach(function (filepath) {
    clearTimeout(_timeouts[filepath])
  })

  _mtimes = {} // file mtimes
  _files = {} // files being watched
  _intervals = {} // variable polling intervals
  _timeouts = {} // polling setTimeouts

  _textContents = {} // TODO
}

function createWatcher (opts) {
  var _listeners = []

  function _watch (filepath) {
    var _watcher = watch(filepath)

    var _off = undefined

    return {
      on: function (callback) {
        _off = _watcher.on(callback)
        _listeners.push(_off)
        return _off
      },
      close: function () {
        if (typeof _off === 'function') _off()
      }
    }
  }

  function _clear () {
    _listeners.forEach(function (off) {
      off()
    })
  }

  return {
    watch: _watch,
    clear: _clear,
    close: _clear
  }
}

function _exports (opts) {
  return createWatcher(opts)
}

_exports.createWatcher = createWatcher
_exports.create = createWatcher
module.exports = _exports
