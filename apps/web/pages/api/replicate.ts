import { VercelRequest, VercelResponse } from "@vercel/node";
import Replicate from "replicate";
import { list, put, ListBlobResult } from "@vercel/blob";
import { kv } from "@vercel/kv";

const MODEL_IDENTIFIER = "bogini/expression-editor";

interface ExpressionEditorInput {
  image: string;
  rotatePitch?: number;
  rotateYaw?: number;
  rotateRoll?: number;
  pupilX?: number;
  pupilY?: number;
  smile?: number;
  blink?: number;
  wink?: number;
  eyebrow?: number;
  cropFactor?: number;
  srcRatio?: number;
  sampleRatio?: number;
  outputFormat?: "webp" | "png" | "jpg";
  outputQuality?: number;
}

type ReplicateResponse = string[];

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const CACHE_VERSION = "v1";

const getCacheKey = async (input: ExpressionEditorInput) => {
  const data = new TextEncoder().encode(
    JSON.stringify({ modelIdentifier: MODEL_IDENTIFIER, input })
  );
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const getCachePath = (cacheKey: string) => {
  const sanitizedModelIdentifier = decodeURIComponent(MODEL_IDENTIFIER).replace(
    /[^a-zA-Z0-9]/g,
    "_"
  );
  return `cache/${CACHE_VERSION}/${sanitizedModelIdentifier}/${cacheKey}`;
};

const setCache = async (cachePath: string, url: string) => {
  try {
    await kv.set(cachePath, url);
  } catch (error) {
    console.error(`Error setting cache in Redis: ${error}`);
  }
};

const getCachedPredictionFromRedis = async (
  cachePath: string
): Promise<string | null> => {
  const cachedUrl = await kv.get(cachePath);
  if (cachedUrl) {
    return cachedUrl as string;
  }
  return null;
};

const getCachedPredictionFromBlob = async (
  cachePath: string
): Promise<string | null> => {
  const response: ListBlobResult = await list({ prefix: cachePath });
  if (response.blobs.length > 0) {
    const blob = response.blobs[0];

    setCache(cachePath, blob.url);

    return blob.url;
  }
  return null;
};

const getCachedPrediction = async (
  cachePath: string
): Promise<string | null> => {
  const [redisResult, blobResult] = await Promise.allSettled([
    getCachedPredictionFromRedis(cachePath),
    getCachedPredictionFromBlob(cachePath),
  ]);

  if (redisResult.status === "fulfilled" && redisResult.value) {
    return redisResult.value;
  }

  if (blobResult.status === "fulfilled" && blobResult.value) {
    return blobResult.value;
  }

  if (redisResult.status === "rejected") {
    console.error(
      `Error getting cached prediction from Redis: ${redisResult.reason}`
    );
  }

  if (blobResult.status === "rejected") {
    console.error(
      `Error getting cached prediction from Blob Storage: ${blobResult.reason}`
    );
  }

  return null;
};

const cachePrediction = async (
  cachePath: string,
  predictionUrl: string,
  fileExtension: string
) => {
  try {
    const response = await fetch(predictionUrl);
    const blob = await response.blob();
    const cachedBlob = await put(`${cachePath}.${fileExtension}`, blob, {
      access: "public",
    });

    setCache(cachePath, cachedBlob.url);

    return cachedBlob;
  } catch (error) {
    console.error(`Error updating cache for path ${cachePath}: ${error}`);
  }
};

const runModel = async (
  input: ExpressionEditorInput
): Promise<ReplicateResponse> => {
  try {
    let prediction = await replicate.deployments.predictions.create(
      "bogini",
      "expression-editor",
      { input }
    );
    prediction = await replicate.wait(prediction, {
      mode: "poll",
      interval: 10,
    });
    return Array.isArray(prediction.output)
      ? prediction.output
      : [prediction.output];
  } catch (error) {
    console.error(`Error running model: ${error}`);
    throw error;
  }
};

const handler = async (req: VercelRequest, res: VercelResponse) => {
  const start = Date.now();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send(null);
  }

  const { outputFormat = "webp", ...input } = req.body as ExpressionEditorInput;

  try {
    const cacheKey = await getCacheKey(input);
    const cachePath = getCachePath(cacheKey);

    const cachedPrediction = await getCachedPrediction(cachePath);

    if (cachedPrediction) {
      const duration = Date.now() - start;
      console.log({
        cacheKey,
        duration,
        cacheHit: true,
      });
      return res.status(200).json({ url: cachedPrediction });
    }

    const prediction = await runModel(input);

    console.log({ prediction, input });

    const url = prediction[0];

    cachePrediction(cachePath, url, outputFormat);

    const duration = Date.now() - start;

    console.log({
      cacheKey,
      duration,
      cacheHit: false,
    });

    return res.status(200).json({ url });
  } catch (error) {
    const duration = Date.now() - start;

    console.error({
      error: error instanceof Error ? error.message : error,
      duration,
    });

    return res.status(500).json({
      error: `Error processing request: ${error instanceof Error ? error.message : error}`,
    });
  }
};

export default handler;
