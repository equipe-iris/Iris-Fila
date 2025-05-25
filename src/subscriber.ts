import amqplib from 'amqplib';
import dotenv from 'dotenv';
import AWS from 'aws-sdk';

dotenv.config();

const RABBITMQ_URL = process.env.QUEUE_RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const QUEUE_NAME = process.env.QUEUE_NAME || 'task_queue';
const S3_ENDPOINT = process.env.QUEUE_S3_ENDPOINT_URL!;
const S3_BUCKET = process.env.QUEUE_S3_BUCKET!;

AWS.config.update({
  accessKeyId: process.env.QUEUE_AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.QUEUE_AWS_SECRET_ACCESS_KEY,
  region: process.env.QUEUE_AWS_REGION,
});
const s3 = new AWS.S3({
  endpoint: S3_ENDPOINT,
  s3ForcePathStyle: true,
});

async function connectRabbitMQ() {
  let connection;
  let attempts = 0;
  const maxAttempts = 10;
  
  while (!connection && attempts < maxAttempts) {
    try {
      attempts++;
      console.log(`Connecting to RabbitMQ (attempt ${attempts}/${maxAttempts})...`);
      connection = await amqplib.connect(RABBITMQ_URL);
      console.log('Connected to RabbitMQ');
    } catch (error) {
      console.log(`Connection failed: ${error}`);
      if (attempts >= maxAttempts) {
        throw new Error('Failed to connect to RabbitMQ');
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  return connection;
}

async function consume() {
  const conn = await connectRabbitMQ();
  if (!conn) {
    throw new Error('Failed to establish a RabbitMQ connection.');
  }
  const channel = await conn.createChannel();
  await channel.assertQueue(QUEUE_NAME, { durable: true });
  channel.prefetch(1);
  console.log(`Waiting for messages in ${QUEUE_NAME}`);

  channel.consume(QUEUE_NAME, async msg => {
    if (msg) {
      try {
        const content = JSON.parse(msg.content.toString());
        const { fileId, bucket, originalName, timestamp } = content;
        
        console.log(`Processing file ${originalName} with ID ${fileId}, enqueued at ${new Date(timestamp).toISOString()}`);

        const fileData = await s3.getObject({
          Bucket: bucket,
          Key: fileId
        }).promise();

        console.log(`Downloaded file ${fileId} from S3, size: ${fileData.Body?.toString().length || 0} bytes`);

        await s3.deleteObject({
          Bucket: bucket,
          Key: fileId
        }).promise();

        console.log(`Deleted file ${fileId} from S3`);

        channel.ack(msg);
      } catch (error) {
        console.error('Error processing message:', error);
        channel.nack(msg, false, false);
      }
    }
  });
}

consume().catch(console.error);
