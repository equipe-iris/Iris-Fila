import express from 'express';
import multer from 'multer';
import amqplib from 'amqplib';
import dotenv from 'dotenv';
import { S3Client, CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';

dotenv.config();

const RABBITMQ_URL = process.env.QUEUE_RABBITMQ_URL!;
const QUEUE_NAME = process.env.QUEUE_NAME!;
const S3_ENDPOINT = process.env.QUEUE_S3_ENDPOINT_URL!;
const S3_BUCKET = process.env.QUEUE_S3_BUCKET!;

const s3Config: any = {
  region: process.env.QUEUE_AWS_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.QUEUE_AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.QUEUE_AWS_SECRET_ACCESS_KEY || ''
  },
  forcePathStyle: true
};

if (process.env.QUEUE_AWS_SESSION_TOKEN) {
  s3Config.credentials.sessionToken = process.env.QUEUE_AWS_SESSION_TOKEN;
}

const s3 = new S3Client(s3Config);

async function connectRabbitMQ() {
  let connection;
  let attempts = 0;
  const maxAttempts = 20;
  
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

async function start() {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
  } catch (err) {
    console.log('Bucket already exists or creation failed');
  }

  const conn = await connectRabbitMQ();
  if (!conn) {
    throw new Error('RabbitMQ connection is undefined');
  }
  const channel = await conn.createChannel();
  await channel.assertQueue(QUEUE_NAME, { durable: true });

  const app = express();
  const upload = multer();

  app.post('/enqueue', upload.array('file'), async (req, res) => {
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const fileIds = req.body.fileId;
    if (!fileIds) {
      return res.status(400).json({ error: 'No fileId provided' });
    }

    const ids = Array.isArray(fileIds) ? fileIds : [fileIds];
    const files = req.files as Express.Multer.File[];

    if (files.length !== ids.length) {
      return res.status(400).json({ error: 'Number of files and fileIds must match' });
    }

    try {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
      } catch (err) {
      }

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileId = ids[i];

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: fileId,
          Body: file.buffer,
          ContentType: file.mimetype,
        }));

        const msg = { 
          fileId,
          bucket: S3_BUCKET, 
          originalName: file.originalname,
          timestamp: Date.now() 
        };
        channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(msg)), { persistent: true });

        console.log(`File ${file.originalname} uploaded to S3 with key ${fileId} and queued`);
      }

      return res.status(200).json({ 
        message: 'Files enqueued successfully',
        processedFiles: files.length 
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to enqueue files' });
    }
  });

  const port = process.env.QUEUE_PORT || 3000;
  app.listen(port, () => console.log(`Queue service on ${port}`));
}

start().catch(console.error);
