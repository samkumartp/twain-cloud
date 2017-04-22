'use strict';

const uuid = require('uuid');
const dynamo = require('../utils/dbClient');

const scannersTable = process.env.ATALA_SCANNERS_TABLE;

module.exports.getScanners = (event, context, callback) => {

  const params = {
    TableName: scannersTable
  };

  let scanners = [];

  dynamo.scan(params, function onScan(err, data) {
    if (err) return callback(err);

    data.Items.forEach(function(scanner) {
      scanner.url = `/scanners/${scanner.id}`;
      scanner.api = [
        `/scanners/${scanner.id}/privet/info`,
        `/scanners/${scanner.id}/privet/twaindirect/session`
      ];
    });

    scanners = scanners.concat(data.Items);

    // continue scanning if we have more movies, because
    // scan can retrieve a maximum of 1MB of data
    if (typeof data.LastEvaluatedKey != 'undefined') {
      console.log('Scanning for more...');
      params.ExclusiveStartKey = data.LastEvaluatedKey;
      dynamo.scan(params, onScan);
    } else {
      // return found scanners to the client
      callback(null, scanners);
    }
  });
};

module.exports.loginScanner = (event, context, callback) => {

  const scannerInfo = event.body;
  console.log(scannerInfo);

  // generate x-privet-token to authenticate furhter requests
  scannerInfo['x-privet-token'] = uuid.v4();

  const params = {
    TableName: scannersTable,
    Item: scannerInfo
  };

  dynamo.putItem(params, (err, data) => {
    if (err) return callback(err);
    callback(null, data);
  });
};
