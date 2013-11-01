/**
 * Module dependencies
 */

var _        = require('underscore')
  , util     = require('util')
  , uuid     = require('node-uuid')
  , crypto   = require('crypto')  
  , validate = require('./validate')
  ;


/**
 * Abstract Constructor
 */

function Modinha (data, options) {
  this.initialize(data, options || {});
}


/**
 * Default value generator functions
 */

Modinha.defaults = {};

Modinha.defaults.uuid = function () {
  return uuid.v4();
};

Modinha.defaults.random = function (len) {
  return function () {
    return crypto.randomBytes(len || 10).toString('hex');  
  }
};

Modinha.defaults.timestamp = function () {
  return Date.now();
}


/**
 * Model definition
 *
 * Most model definitions require no options other than 
 * a schema and it's more readable to explicitly define 
 * static and prototype properties directly on the model 
 * and its prototype.
 *
 * Modinha.define makes creating models a little cleaner.
 * At present it only works when called directly on Modinha.
 */

Modinha.define = function (schema) {
  if (!schema) {
    throw new UndefinedSchemaError();
  }

  var subClass = this.inherit(null, { schema: schema })

  return subClass;
};


/**
 * Inherit
 *
 * Calling inherit on Modinha or a model will return 
 * a new model. It works similar "extends", but instead
 * of mutating the receiver, it creates a new model that 
 * inherits from the receiver.
 */

function F () {}

Modinha.inherit = function (proto, static) {

  if (this.name === 'Modinha' && (!static || !static.schema)) { 
    throw new UndefinedSchemaError(); 
  }

  var superClass = this;

  var subClass = function () {
    superClass.apply(this, arguments);
  };

  F.prototype = superClass.prototype;
  subClass.prototype = new F();

  _.extend(subClass.prototype, proto);
  _.extend(subClass, superClass, static);

  subClass.prototype.constructor = subClass;
  subClass.superclass = superClass.prototype;

  return subClass;
}


/**
 * Extend
 *
 * This is a mixin method. It extend the model it's called
 * on with another class, or with explicit prototype and 
 * static arguments.
 */

Modinha.extend = function () {
  var Constructor = this
    , args = Array.prototype.slice.call(arguments)
    , proto
    , stat
    ;

  // treat a function as a constructor
  if (typeof args[0] === 'function') {
    stat  = args[0];
    proto = stat.prototype;
  } 

  // assume there are two object args
  else {
    proto = args[0] || null;
    stat  = args[1] || null;
  }

  _.extend(Constructor.prototype, proto);
  _.extend(Constructor, stat);
}


/**
 * Initialize instance
 *
 * This is not intended to be called directly. 
 * It is used by the Model constructor to build up 
 * a new object. It doesn't return a value, because
 * we can't assign to `this`. Instead, initialize 
 * mutates the instance under construction.
 */

Modinha.prototype.initialize = function (data, options) {
  var Constructor = this.constructor
    , instance = this;

  if (!data) { data = {}; }

  // initialize by selection
  if (options.select) {
    select(data, instance, options.select);
  }

  // initialize by mapping
  else if (options.map) {

    // resolve named mapping
    if (typeof options.map === 'string') {
      options.map = Constructor.maps[options.map]
    }

    map(data, instance, options.map);
  }

  // initialize by schema
  else {
    set(data, instance, Constructor.schema, options);
  }
}


/**
 * Initialize
 *
 * Unlike Modinha.prototype.initialize, this method *is* 
 * intended to be called directly. It provides enhanced 
 * initialization logic that probably doesn't belong directly 
 * in the constructor.
 *
 * If passed multiple values, it will initialize several
 * instances. If passed JSON, it will parse the JSON with 
 * error handling and reinvoke itself with the parsed object.
 *
 * If passed undefined or null, if will optionally skip
 * instantiating an object and return null. This is useful
 * for handling empty database responses.
 */

Modinha.initialize = function (data, options) {
  // get a reference to model this 
  // method is called on
  var Constructor = this;

  // set options if not provided in arguments
  if (!options) { 
    options = {}; 
  }

  // return null instead of a new instance
  // if the nullify option is provided
  if (!data && options.nullify) { 
    return null; 
  }

  // parse JSON and reinvoke this method if 
  // data is a string instead of an object
  if (typeof data === 'string') {
    data = parseJSON(data);
    Constructor.initialize(data, options);
  }

  // reinvoke this method for each item in an array
  if (Array.isArray(data)) {
    return data.map(function (item) {
      return Constructor.initialize(item, options);
    });
  }

  // if we made it this far, it's time to get to work
  return new Constructor(data || {}, options);
}


/**
 * Wrap JSON.parse in a try/catch block
 */

function parseJSON (data) {
  try {
    return JSON.parse(data);
  } catch (e) {
    throw new Error('failed to parse JSON');
  }
}


/**
 * Set
 *
 * Recurse through nested schema properties and
 * copy values from the provided attrs onto `this`.
 */

function set (source, target, schema, options) {
  var keys = Object.keys(schema);

  keys.forEach(function (key) {

    // If the value of the property has a "properties" property
    // treat it as a nested schema ...
    if (schema[key].properties) {

      // Define a nested object on `this`.
      if (!target[key]) { target[key] = {}; }

      // Recurse through the nested attrs/schema, setting
      // properties provided by attrs.
      set(source[key] || {}, target[key], schema[key].properties, options);

    // Otherwise treat the key as a simple attribute.
    } else {

      // check that the property is public or that private properties
      // are requested.
      if (!schema[key].private || options.private) {

        // If the data source provides a value, copy it to `this`.
        if (source[key] !== undefined) {

          target[key] = source[key]; 

        // If not, and the schema provides a default value...
        } else if (schema[key].default) {

          // ... check it's type. If the default is a function, invoke 
          // it and assign its returned value. Otherwise, copy it from 
          // the schema to `this`.
          var defaultValue = schema[key].default;
          target[key] = (typeof defaultValue === 'function')
                      ? defaultValue()
                      : defaultValue;  

        }
      }
    }
  });
}


/**
 * Select
 *
 * We can think of a selection as a shorthand
 * or macro (in the lisp sense) for a mapping.
 */

function select (data, instance, selection) {
  var mapping = {};

  selection.forEach(function (property) {
    mapping[property] = property;
  });

  map(data, instance, mapping);
}


/**
 * Map
 * 
 * By interpreting a mapping, we can instantiate an object 
 * based on a very different kind of object.
 *
 * This is useful for consuming third party API responses, and
 * it also comes in handy for selecting a subset of an object.
 * `select` provides a shortcut for this.
 */

function map (data, instance, mapping) {
  var paths = Object.keys(mapping);

  paths.forEach(function (path) {
    var dataKeys = mapping[path].split('.')
      , instanceKeys = path.split('.')
      , value = getFromMapping(data, dataKeys)
      ;

    setFromMapping(instance, instanceKeys, value);
  });
}


/**
 * getter/setter for mapping properties in nested objects
 */

function getFromMapping (data, chain) {
  var key = chain.shift();

  // there's nothing to see here, move along
  if (data[key] === undefined) { return; }
  // we're at the end of the line, this is the value you're looking for
  if (data[key] && chain.length === 0) { return data[key]; }
  // traverse the object
  if (data[key] !== undefined) { return getFromMapping(data[key], chain); }
}

function setFromMapping (target, chain, value) {
  var key = chain.shift();

  if (chain.length === 0) { 
    target[key] = value;
  } else {
    if (!target[key]) { target[key] = {}; }
    setFromMapping(target[key], chain, value);
  }

}


/**
 * Named mappings
 */

Modinha.maps = {};


/**
 * Validate data against the schema with either a
 * static method or an instance method.
 */

Modinha.validate = function (data) {
  return validate(data, this.schema);
};

Modinha.prototype.validate = function() {
  var Constructor = this.constructor;
  return validate(this, Constructor.schema);
};


/**
 * ValidationError
 */

Modinha.ValidationError = validate.ValidationError;


/**
 * UndefinedSchemaError
 */

function UndefinedSchemaError() {
  this.name = 'UndefinedSchemaError';
  this.message = 'Extending Model requires a schema';
  Error.call(this, this.message);
  Error.captureStackTrace(this, arguments.callee);
}

util.inherits(UndefinedSchemaError, Error);
Modinha.UndefinedSchemaError = UndefinedSchemaError;


/**
 * Exports
 */

module.exports = Modinha;