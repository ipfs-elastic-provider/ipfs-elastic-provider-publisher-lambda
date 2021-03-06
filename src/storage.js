const { BufferList } = require('bl')
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3')
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs')
const { NodeHttpHandler } = require('@aws-sdk/node-http-handler')
const { Agent } = require('https')

const { logger, serializeError } = require('./logging')
const telemetry = require('./telemetry')

const agent = new Agent({ keepAlive: true, keepAliveMsecs: 60000 })

const sqsClient = new SQSClient({
  requestHandler: new NodeHttpHandler({ httpsAgent: agent })
})

const s3Client = new S3Client({
  requestHandler: new NodeHttpHandler({ httpsAgent: new Agent({ keepAlive: true, keepAliveMsecs: 60000 }) })
})

async function fetchFromS3(bucket, key) {
  try {
    telemetry.increaseCount('s3-fetchs')

    // Download from S3
    const record = await telemetry.trackDuration(
      's3-fetchs',
      s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    )
    const buffer = new BufferList()

    for await (const chunk of record.Body) {
      buffer.append(chunk)
    }

    return buffer.slice()
  } catch (e) {
    logger.error(`Cannot download file ${key} from S3 bucket ${bucket}: ${serializeError(e)}`)
    throw e
  }
}

async function uploadToS3(bucket, key, content) {
  try {
    telemetry.increaseCount('s3-uploads')

    await telemetry.trackDuration(
      's3-uploads',
      s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: content, ContentType: 'application/json' }))
    )
  } catch (e) {
    logger.error(`Cannot upload file ${key} to S3 bucket ${bucket}: ${serializeError(e)}`)

    throw e
  }
}

async function publishToSQS(queue, data, additionalAttributes = {}) {
  try {
    telemetry.increaseCount('sqs-publishes')

    await telemetry.trackDuration(
      'sqs-publishes',
      sqsClient.send(new SendMessageCommand({ QueueUrl: queue, MessageBody: data, ...additionalAttributes }))
    )
  } catch (e) {
    logger.error(`Cannot publish a block to ${queue}: ${serializeError(e)}`)

    throw e
  }
}

module.exports = { fetchFromS3, uploadToS3, publishToSQS }
