/**
 * @license Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const path = require('path');
const MessageFormat = require('intl-messageformat').default;
const MessageParser = require('intl-messageformat-parser');
const LOCALES = require('./locales');

let locale = MessageFormat.defaultLocale;

const LH_ROOT = path.join(__dirname, '../../');

try {
  // Node usually doesn't come with the locales we want built-in, so load the polyfill.
  // In browser environments, we won't need the polyfill, and this will throw so wrap in try/catch.

  // @ts-ignore
  const IntlPolyfill = require('intl');
  // @ts-ignore
  Intl.NumberFormat = IntlPolyfill.NumberFormat;
  // @ts-ignore
  Intl.DateTimeFormat = IntlPolyfill.DateTimeFormat;
} catch (_) {}

const UIStrings = {
  ms: '{timeInMs, number, milliseconds}\xa0ms',
  columnURL: 'URL',
  columnSize: 'Size (KB)',
  columnWastedTime: 'Potential Savings (ms)',
};

const formats = {
  number: {
    milliseconds: {
      maximumFractionDigits: 0,
    },
  },
};

/**
 * @param {string} msg
 * @param {Record<string, *>} values
 */
function preprocessMessageValues(msg, values) {
  if (!values) return;

  const clonedValues = JSON.parse(JSON.stringify(values));
  const parsed = MessageParser.parse(msg);
  // Round all milliseconds to 10s place
  parsed.elements
    .filter(el => el.format && el.format.style === 'milliseconds')
    .forEach(el => (clonedValues[el.id] = Math.round(clonedValues[el.id] / 10) * 10));

  // Replace all the bytes with KB
  parsed.elements
    .filter(el => el.format && el.format.style === 'bytes')
    .forEach(el => (clonedValues[el.id] = clonedValues[el.id] / 1024));

  return clonedValues;
}

/**
 * @typedef StringUsage
 * @prop {string} key
 * @prop {string} template
 * @prop {*} [values]
 */

/** @type {Map<string, StringUsage[]>} */
const formattedStringUsages = new Map();

function formatTemplate(locale, key, template, values) {
  const localeTemplates = LOCALES[locale] || {};
  const localeTemplate = localeTemplates[key] && localeTemplates[key].message;
  // fallback to the original english message if we couldn't find a message in the specified locale
  // better to have an english message than no message at all, in some number cases it won't even matter
  const templateForMessageFormat = localeTemplate || template;
  // when using accented english, force the use of a different locale for number formatting
  const localeForMessageFormat = locale === 'en-XA' ? 'de-DE' : locale;
  // pre-process values for the message format like KB and milliseconds
  const valuesForMessageFormat = preprocessMessageValues(template, values);

  const formatter = new MessageFormat(templateForMessageFormat, localeForMessageFormat, formats);
  const message = formatter.format(valuesForMessageFormat);

  return {message, template: templateForMessageFormat}
}

module.exports = {
  UIStrings,
  /**
   * @param {string} filename
   * @param {Record<string, string>} fileStrings
   */
  createStringFormatter(filename, fileStrings) {
    const mergedStrings = {...UIStrings, ...fileStrings};

    /** @param {string} template @param {*} [values] */
    const formatFn = (template, values) => {
      const keyname = Object.keys(mergedStrings).find(key => mergedStrings[key] === template);
      if (!keyname) throw new Error(`Could not locate: ${template}`);

      const filenameToLookup = keyname in UIStrings ? __filename : filename;
      const key = path.relative(LH_ROOT, filenameToLookup) + '!#' + keyname;
      const keyUsages = formattedStringUsages.get(key) || [];
      keyUsages.push({key, template, values});
      formattedStringUsages.set(key, keyUsages);

      return `${key}#${keyUsages.length - 1}`;
    };

    return formatFn;
  },
  /**
   * @param {LH.Locale|null} [newLocale]
   */
  setLocale(newLocale) {
    if (!newLocale) return;
    locale = newLocale;
  },
  /**
   * @param {LH.Result} lhr
   */
  replaceLocaleStringReferences(lhr, locale) {
    function replaceInObject(obj, log, path = []) {
      if (typeof obj !== 'object' || !obj) return;

      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path.concat([key]);
        if (typeof value === 'string' && /.*!#.*#\d+$/.test(value)) {
          const [_, templateKey, usageIndex] = value.match(/(.*)#(\d+)$/)
          const templateLogRecord = log[templateKey] || {}
          const usages = formattedStringUsages.get(templateKey) || []
          const usage = usages[usageIndex]

          const occurrences = templateLogRecord.occurrences || []
          occurrences.push({values: usage.values, path: currentPath})

          const {message, template} = formatTemplate(locale, templateKey, usage.template, usage.values);
          obj[key] = message
          templateLogRecord.template = template
          templateLogRecord.occurrences = occurrences
          log[templateKey] = templateLogRecord
        } else {
          replaceInObject(value, log, currentPath)
        }
      }
    }

    const log = {}
    replaceInObject(lhr, log)
    lhr.localeLog = log
  },
};
