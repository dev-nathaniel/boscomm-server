import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import routes from './routes';
import cors from 'cors';
import { registerSocketHandlers } from './sockets';
import {setLogEventListeners, version, types as MediasoupTypes, createWorker} from 'mediasoup';
dotenv.config();

// Global variables
let worker: MediasoupTypes.Worker;
let producer: MediasoupTypes.Producer;
let consumer: MediasoupTypes.Consumer;
let producerTransport: MediasoupTypes.Transport;
let consumerTransport: MediasoupTypes.Transport;
let mediasoupRouter: MediasoupTypes.Router;

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' }
});

app.use(express.json());
app.use('/api', routes);
app.use(cors());

registerSocketHandlers(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

console.log(`Mediasoup version: ${version}`);

setLogEventListeners({
  ondebug: (namespace, log) => console.log(`DEBUG: ${namespace} ${log}`),
    onwarn: (namespace, log) => console.warn(`WARN: ${namespace} ${log}`),
    onerror: (namespace, log, error) => {
        if(error){
            console.error(`ERROR: ${namespace} ${log}: ${error}`);
        }
        else{
            console.error(`ERROR: ${namespace} ${log}`);
        }
    }
});

async function runSocketServer() {

  io.on('connection', (socket) => {
    console.log('client connected');

    // inform the client about existence of producer
    if (producer) {
      socket.emit('newProducer');
    }

    socket.on('disconnect', () => {
      console.log('client disconnected');
    });

    socket.on('connect_error', (err) => {
      console.error('client connection error', err);
    });

    socket.on('getRouterRtpCapabilities', (callback) => {
      callback({ rtpCapabilities: mediasoupRouter.rtpCapabilities});
    });

    socket.on('createProducerTransport', async (data, callback) => {
      try {
        const { transport, params } = await createWebRtcTransport();
        producerTransport = transport;
        callback(params);
      } catch (err: any) {
        console.error(err);
        callback({ error: err.message });
      }
    });

    socket.on('createConsumerTransport', async (data, callback) => {
      try {
        const { transport, params } = await createWebRtcTransport();
        consumerTransport = transport;
        callback(params);
      } catch (err: any) {
        console.error(err);
        callback({ error: err.message });
      }
    });

    socket.on('connectProducerTransport', async (data, callback) => {
      try {
      await producerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
      } catch (err: any) {
        console.error(err);
        callback({ error: err.message });
      }
    });

    socket.on('connectConsumerTransport', async (data, callback) => {
      await consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });

    socket.on('produce', async (data, callback) => {
      const {kind, rtpParameters} = data;
      producer = await producerTransport.produce({ kind, rtpParameters });
      callback({ id: producer.id });

      // inform clients about new producer
      socket.broadcast.emit('newProducer');
    });

    socket.on('consume', async (data, callback) => {
      callback(await createConsumer(producer, data.rtpCapabilities));
    });

    socket.on('resume', async (callback) => {
      await consumer.resume();
      callback();
    });
  });
}

(async () => {
  await runMediasoupWorker();
  await runSocketServer();
})().catch((error) => {
  console.error('Error in setup:', error);
  process.exit(1);
});

async function runMediasoupWorker() {
  worker = await createWorker({
    logLevel: "warn",
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });

  worker.on('died', () => {
    console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
    setTimeout(() => process.exit(1), 2000);
  });

  const mediaCodecs: MediasoupTypes.RouterRtpCodecCapability[] = [
          {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2
          },
          {
            kind: 'video',
            mimeType: 'video/VP8',
            clockRate: 90000,
            parameters:
              {
                'x-google-start-bitrate': 1000
              }
          },
        ];
  mediasoupRouter = await worker.createRouter({ mediaCodecs });
}

async function createWebRtcTransport() {
  const maxIncomingBitrate = 1500000
  const initialAvailableOutgoingBitrate = 1000000
    

  const transport = await mediasoupRouter.createWebRtcTransport({
    listenIps: [
        {
          ip: '127.0.0.1',
          announcedIp: undefined,
        }
      ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate,
  });
  if (maxIncomingBitrate) {
    try {
      await transport.setMaxIncomingBitrate(maxIncomingBitrate);
    } catch (error) {
    }
  }
  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    },
  };
}

async function createConsumer(producer: MediasoupTypes.Producer, rtpCapabilities: MediasoupTypes.RtpCapabilities) {
  if (!mediasoupRouter.canConsume(
    {
      producerId: producer.id,
      rtpCapabilities,
    })
  ) {
    console.error('can not consume');
    return;
  }
  try {
    consumer = await consumerTransport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: producer.kind === 'video',
    });
  } catch (error) {
    console.error('consume failed', error);
    return;
  }

  if (consumer.type === 'simulcast') {
    await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
  }

  return {
    producerId: producer.id,
    id: consumer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    type: consumer.type,
    producerPaused: consumer.producerPaused
  };
}