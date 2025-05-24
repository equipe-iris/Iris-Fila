import express from 'express';
import multer from 'multer';
import amqplib from 'amqplib';
import dotenv from 'dotenv';
import AWS from 'aws-sdk';

dotenv.config();

const RABBITMQ_URL = process.env.RABBITMQ_URL!;
const QUEUE_NAME = process.env.QUEUE_NAME!;
const S3_ENDPOINT = process.env.S3_ENDPOINT_URL!;
const S3_BUCKET = process.env.S3_BUCKET!;

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});
const s3 = new AWS.S3({
  endpoint: S3_ENDPOINT,
  s3ForcePathStyle: true,
});

async function start() {
  try {
    await s3.createBucket({ Bucket: S3_BUCKET }).promise();
  } catch (err) {}

  const conn = await amqplib.connect(RABBITMQ_URL);
  const channel = await conn.createChannel();
  await channel.assertQueue(QUEUE_NAME, { durable: true });

  const app = express();
  const upload = multer();

  app.post('/enqueue', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const key = `${Date.now()}-${req.file.originalname}`;
    try {
      await s3.putObject({
        Bucket: S3_BUCKET,
        Key: key,
        Body: req.file.buffer,
      }).promise();

      const msg = { bucket: S3_BUCKET, key, timestamp: Date.now() };
      channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(msg)), { persistent: true });

      return res.status(200).send('File enqueued');
    } catch (err) {
      console.error(err);
      return res.status(500).send('Failed to enqueue');
    }
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Queue service on ${port}`));
}

start().catch(console.error);
