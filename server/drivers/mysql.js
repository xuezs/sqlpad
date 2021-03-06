const mysql = require('mysql')
const QueryResult = require('../models/QueryResult')
const { formatSchemaQueryResults } = require('./utils')

function getSchemaSql(database) {
  const whereSql = database
    ? `WHERE t.table_schema = '${database}'`
    : `WHERE t.table_schema NOT IN (
        'mysql', 
        'performance_schema', 
        'information_schema'
      )`
  return `
    SELECT 
      t.table_schema, 
      t.table_name, 
      c.column_name, 
      c.data_type
    FROM 
      INFORMATION_SCHEMA.TABLES t 
      JOIN INFORMATION_SCHEMA.COLUMNS c ON t.table_schema = c.table_schema AND t.table_name = c.table_name 
    ${whereSql}
    ORDER BY 
      t.table_schema, 
      t.table_name, 
      c.ordinal_position
  `
}

function runQuery(query, connection) {
  const queryResult = new QueryResult()
  const myConnection = mysql.createConnection({
    multipleStatements: true,
    host: connection.host,
    port: connection.port ? connection.port : 3306,
    user: connection.username,
    password: connection.password,
    database: connection.database,
    insecureAuth: connection.mysqlInsecureAuth,
    timezone: 'Z',
    supportBigNumbers: true
  })

  return new Promise((resolve, reject) => {
    myConnection.connect(err => {
      if (err) {
        return reject(err)
      }
      let rowCounter = 0
      let queryError
      let resultsSent = false

      function continueOn() {
        if (!resultsSent) {
          resultsSent = true
          if (queryError) {
            return reject(queryError)
          }
          return resolve(queryResult)
        }
      }

      const myQuery = myConnection.query(query)
      myQuery
        .on('error', function(err) {
          // Handle error,
          // an 'end' event will be emitted after this as well
          // so we'll call the callback there.
          queryError = err
        })
        .on('result', function(row) {
          rowCounter++
          if (rowCounter <= connection.maxRows) {
            // if we haven't hit the max yet add row to results
            queryResult.addRow(row)
          } else {
            // Too many rows! pause that connection.
            // It sounds like there is no way to close query stream
            // you just have to close the connection
            myConnection.pause()
            queryResult.incomplete = true
            continueOn() // return records to client before closing connection
            myConnection.end()
          }
        })
        .on('end', function() {
          // all rows have been received
          // This will not fire if we end the connection early
          continueOn()
          myConnection.end()
        })
    })
  })
}

/**
 * Test connectivity of connection
 * @param {*} connection
 */
function testConnection(connection) {
  const query = "SELECT 'success' AS TestQuery;"
  return runQuery(query, connection)
}

/**
 * Get schema for connection
 * @param {*} connection
 */
function getSchema(connection) {
  const schemaSql = getSchemaSql(connection.database)
  return runQuery(schemaSql, connection).then(queryResult =>
    formatSchemaQueryResults(queryResult)
  )
}

module.exports = {
  getSchema,
  runQuery,
  testConnection
}
