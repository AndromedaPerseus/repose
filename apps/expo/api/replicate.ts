import axios from "axios";
import { BASE_URL } from "./constants";
import AsyncStorage from "@react-native-community/async-storage";
import * as Crypto from "expo-crypto";
import {
  DEFAULT_FACE_VALUES,
  FACE_CONTROLS,
  FaceControl,
  FaceValues,
} from "../lib/faceControl";
import { Image } from "expo-image";
import pLimit from "p-limit";

const REPLICATE_ENDPOINT = BASE_URL + "/api/replicate";
const MAX_CONCURRENT_REQUESTS = 250;
export const NUM_BUCKETS = 6;

const getBucketValue = (
  value: number | undefined,
  min: number,
  max: number
) => {
  if (value === undefined) return undefined;
  const range = max - min;
  const bucketSize = range / NUM_BUCKETS;
  const bucketIndex = Math.round((value - min) / bucketSize);
  const bucketValue = Math.min(
    Math.max(min + bucketIndex * bucketSize, min),
    max
  );
  return Math.round(bucketValue * 100) / 100;
};

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

const DEFAULTS = {
  outputFormat: "webp" as const,
  outputQuality: 100,
  sampleRatio: 1,
  cropFactor: 2.5,
  srcRatio: 1,
};

interface ReplicateResponse {
  url: string;
}

class ReplicateService {
  private cancelTokenSource = axios.CancelToken.source();
  private inMemoryCache: Record<string, string> = {};
  private prefetchQueue: Set<string> = new Set();

  private async getFromCache(key: string): Promise<string | undefined> {
    // Try memory cache first
    const inMemoryValue = this.inMemoryCache[key];
    if (inMemoryValue) return inMemoryValue;

    try {
      // Then check AsyncStorage
      const asyncStorageValue = await AsyncStorage.getItem(key);
      if (asyncStorageValue) {
        this.inMemoryCache[key] = asyncStorageValue;
        return asyncStorageValue;
      }
    } catch (error) {
      console.warn("Cache read error:", error);
    }

    return undefined;
  }

  private async setInCache(key: string, value: string): Promise<void> {
    this.inMemoryCache[key] = value;
    try {
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.warn("Cache write error:", error);
    }
  }

  private async prefetchImage(url: string): Promise<void> {
    if (this.prefetchQueue.has(url)) return;

    this.prefetchQueue.add(url);
    try {
      await Image.prefetch(url, { cachePolicy: "memory-disk" });
    } catch (error) {
      console.warn("Image prefetch error:", error);
    } finally {
      this.prefetchQueue.delete(url);
    }
  }

  clearInMemoryCache(): void {
    this.inMemoryCache = {};
  }

  async runExpressionEditor(
    input: ExpressionEditorInput,
    shouldCancel: boolean = true,
    skipCache: boolean = false
  ): Promise<string | undefined> {
    const {
      outputFormat = DEFAULTS.outputFormat,
      outputQuality = DEFAULTS.outputQuality,
      sampleRatio = DEFAULTS.sampleRatio,
      cropFactor = DEFAULTS.cropFactor,
      srcRatio = DEFAULTS.srcRatio,
      ...rest
    } = input;

    if (shouldCancel) {
      try {
        this.cancelTokenSource.cancel("Request canceled due to new request");
      } catch (error) {
        if (!axios.isCancel(error)) {
          console.error("Error canceling previous request:", error);
          throw error;
        }
      }
      this.cancelTokenSource = axios.CancelToken.source();
    }

    try {
      const payload = {
        blink: getBucketValue(rest.blink, -20, 5),
        crop_factor: cropFactor,
        eyebrow: getBucketValue(rest.eyebrow, -10, 15),
        image: rest.image,
        output_format: outputFormat,
        output_quality: outputQuality,
        pupil_x: getBucketValue(rest.pupilX, -15, 15),
        pupil_y: getBucketValue(rest.pupilY, -15, 15),
        rotate_pitch: getBucketValue(rest.rotatePitch, -20, 20),
        rotate_roll: getBucketValue(rest.rotateRoll, -20, 20),
        rotate_yaw: getBucketValue(rest.rotateYaw, -20, 20),
        sample_ratio: sampleRatio,
        smile: getBucketValue(rest.smile, -0.3, 1.3),
        src_ratio: srcRatio,
      };

      const cacheKey = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(payload)
      );

      if (!skipCache) {
        const cachedResponse = await this.getFromCache(cacheKey);
        if (cachedResponse) return cachedResponse;
      }

      // console.log("Request", cacheKey);

      const { data } = await axios.post<ReplicateResponse>(
        REPLICATE_ENDPOINT!,
        payload,
        { cancelToken: this.cancelTokenSource.token }
      );

      const imageUrl = data.url;
      await this.setInCache(cacheKey, imageUrl);

      // console.log(
      //   `Response ${Math.round(performance.now() - startTime)}ms`,
      //   cacheKey
      // );

      return imageUrl;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          console.error("Axios error response:", error.response.data);
        } else if (error.request) {
          console.error("Axios error request:", error.request);
        }
      } else {
        console.error("Request error:", error);
      }
    }
  }

  async cacheExpressionEditorResults(
    image: ExpressionEditorInput["image"]
  ): Promise<string[]> {
    const startTime = performance.now();
    const results: string[] = [];
    const totalCount = Math.pow(NUM_BUCKETS + 1, 3) + FACE_CONTROLS.length;
    const concurrently = pLimit(MAX_CONCURRENT_REQUESTS);

    const processRotation = async (
      rotatePitch: number,
      rotateYaw: number,
      rotateRoll: number,
      additionalValues: Partial<FaceValues> = {}
    ) => {
      // Find linked values for rotations from FACE_CONTROLS
      const faceControl = FACE_CONTROLS.find(
        (control) => control.key === "face"
      );
      const linkedValues: Partial<FaceValues> = {};

      if (faceControl) {
        // Handle pitch linked values
        const pitchValue = faceControl.values.find(
          (v) => v.key === "rotatePitch"
        );
        if (pitchValue?.linkedValues) {
          pitchValue.linkedValues.forEach(({ key, factor }) => {
            linkedValues[key] = rotatePitch * factor;
          });
        }

        // Handle yaw linked values
        const yawValue = faceControl.values.find((v) => v.key === "rotateYaw");
        if (yawValue?.linkedValues) {
          yawValue.linkedValues.forEach(({ key, factor }) => {
            linkedValues[key] = rotateYaw * factor;
          });
        }
      }

      const updatedInput: ExpressionEditorInput = {
        ...DEFAULT_FACE_VALUES,
        ...linkedValues,
        ...additionalValues,
        ...DEFAULTS,
        image,
        rotatePitch,
        rotateYaw,
        rotateRoll,
      };

      try {
        const result = await this.runExpressionEditor(updatedInput, false);
        if (result) {
          results.push(result);
          Image.prefetch(result, { cachePolicy: "memory-disk" });
        }
      } catch (error) {
        console.error(error);
      }
    };

    const generateRotations = (roll: number) => {
      const rotationMin = -20;
      const rotationMax = 20;
      const bucketSize = (rotationMax - rotationMin) / NUM_BUCKETS;
      const promises: Promise<void>[] = [];

      for (let i = 0; i <= NUM_BUCKETS; i++) {
        const rotatePitch = getBucketValue(
          rotationMin + bucketSize * i,
          rotationMin,
          rotationMax
        )!;
        for (let j = 0; j <= NUM_BUCKETS; j++) {
          const rotateYaw = getBucketValue(
            rotationMin + bucketSize * j,
            rotationMin,
            rotationMax
          )!;
          promises.push(
            concurrently(() => processRotation(rotatePitch, rotateYaw, roll))
          );
        }
      }

      return promises;
    };

    const processAllRotations = async () => {
      await Promise.all(generateRotations(0));
      for (let k = 1; k <= NUM_BUCKETS; k++) {
        const rotateRoll = getBucketValue(
          -20 + (40 / NUM_BUCKETS) * k,
          -20,
          20
        )!;
        await Promise.all(generateRotations(rotateRoll));
      }
    };

    const processFaceControlValues = async (control: FaceControl) => {
      for (const value of control.values) {
        const bucketSize = (value.max - value.min) / NUM_BUCKETS;
        for (let i = 0; i <= NUM_BUCKETS; i++) {
          const bucketValue = getBucketValue(
            value.min + bucketSize * i,
            value.min,
            value.max
          )!;

          const additionalValues: Partial<FaceValues> = {
            [value.key]: bucketValue,
          };

          // Add linked values if they exist
          if (value.linkedValues) {
            value.linkedValues.forEach(({ key, factor }) => {
              additionalValues[key] = bucketValue * factor;
            });
          }

          await concurrently(() => processRotation(0, 0, 0, additionalValues));
        }
      }
    };

    const processFaceControls = async () => {
      for (const control of FACE_CONTROLS) {
        await processFaceControlValues(control);
      }
    };

    await processAllRotations();
    await processFaceControls();

    console.log(
      `runExpressionEditorWithAllRotations took ${performance.now() - startTime}ms with ${totalCount} requests`
    );

    return results;
  }

  async cacheExpressionEditorResultsWithFaceControls(
    image: ExpressionEditorInput["image"],
    currentFaceValues: FaceValues,
    selectedControl: FaceControl
  ): Promise<void> {
    const startTime = performance.now();
    const concurrently = pLimit(MAX_CONCURRENT_REQUESTS);
    const results = new Set<string>();

    try {
      const processInput = async (input: ExpressionEditorInput) => {
        const cacheKey = JSON.stringify(input);
        const cachedResult = await this.getFromCache(cacheKey);

        if (cachedResult) {
          results.add(cachedResult);
          return;
        }

        try {
          const result = await this.runExpressionEditor(input, false);
          if (result) {
            results.add(result);
            await Promise.all([
              this.setInCache(cacheKey, result),
              this.prefetchImage(result),
            ]);
          }
        } catch (error) {
          console.warn("Failed to process input:", error);
        }
      };

      const generateInputsForControl = async () => {
        // Filter out blink control for eyes and rotateRoll for face
        let controlValues = selectedControl.values;
        if (selectedControl.key === "eyes") {
          controlValues = controlValues.filter((v) => v.key !== "blink");
        } else if (selectedControl.key === "face") {
          controlValues = controlValues.filter((v) => v.key !== "rotateRoll");
        }

        // Generate all possible combinations of values for the selected control
        const valueRanges = controlValues.map((value) => {
          const bucketSize = (value.max - value.min) / NUM_BUCKETS;
          return Array.from({ length: NUM_BUCKETS + 1 }, (_, i) => ({
            value: getBucketValue(
              value.min + bucketSize * i,
              value.min,
              value.max
            ),
            controlValue: value,
          })).filter(
            (v): v is { value: number; controlValue: typeof value } =>
              v.value !== undefined
          );
        });

        // Generate cartesian product of all value combinations
        const combinations = valueRanges.reduce<
          Array<
            Array<{ value: number; controlValue: (typeof controlValues)[0] }>
          >
        >((acc, curr) => {
          if (acc.length === 0) return curr.map((v) => [v]);
          return acc.flatMap((combo) => curr.map((v) => [...combo, v]));
        }, []);

        const promises = combinations.map((combination) => {
          const input: ExpressionEditorInput = {
            ...DEFAULTS,
            ...currentFaceValues,
            image,
          };

          // Apply each value in the combination to its corresponding control
          combination.forEach(({ value, controlValue }) => {
            // Set the primary value
            input[controlValue.key] = value;

            // Apply linked values if they exist
            if (controlValue.linkedValues) {
              controlValue.linkedValues.forEach(({ key, factor }) => {
                input[key] = value * factor;
              });
            }
          });

          return concurrently(() => processInput(input));
        });

        console.log(
          `Generating ${promises.length} inputs for ${selectedControl.label}`
        );

        await Promise.all(promises);
      };

      await generateInputsForControl();

      console.log(
        `Cached ${results.size} unique images for ${selectedControl.label} in ${Math.round(
          performance.now() - startTime
        )}ms`
      );
    } catch (error) {
      console.error("Failed to cache expression editor results:", error);
      throw error;
    }
  }
}

export default new ReplicateService();
