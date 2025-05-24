import amqplib from 'amqplib';
import dotenv from 'dotenv';

dotenv.config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const QUEUE_NAME = process.env.QUEUE_NAME || 'task_queue';

async function consume() {
  const conn = await amqplib.connect(RABBITMQ_URL);
  const channel = await conn.createChannel();
  await channel.assertQueue(QUEUE_NAME, { durable: true });
  channel.prefetch(1);
  console.log(`Waiting for messages in ${QUEUE_NAME}`);

  channel.consume(QUEUE_NAME, async msg => {
    if (msg) {
      const content = JSON.parse(msg.content.toString());
      const { filename, content: base64, timestamp } = content;
      const buffer = Buffer.from(base64, 'base64');
      console.log(`Processing file ${filename}, size ${buffer.length} bytes, enqueued at ${new Date(timestamp).toISOString()}`);

      channel.ack(msg);
    }
  });
}

consume().catch(console.error);
