import { FaceValues } from "../api/replicate";
import { FaceControl, GestureDirection } from "../app/photo/edit/[id]";
import GestureControl, { GestureControlValue } from "./GestureControl";
import { ImageContainer } from "./ImageContainer";
import { useMemo } from "react";

interface FaceControlsComponentProps {
  faceValues: FaceValues;
  onFaceValuesChange: (values: FaceValues) => void;
  selectedControl: FaceControl;
  imageUrl?: string;
  loading?: boolean;
  debug?: boolean;
}

export const FaceGestureControl = ({
  imageUrl,
  faceValues,
  onFaceValuesChange,
  selectedControl,
  loading = false,
  debug = false,
}: FaceControlsComponentProps) => {
  const handleGestureValueChange = ({
    x,
    y,
    rotation,
    scale,
  }: GestureControlValue) => {
    const updatedFaceValues = { ...faceValues };

    selectedControl.values.forEach(({ key, min, max, gesture, direction }) => {
      let value;
      switch (gesture) {
        case "x":
          value = x;
          break;
        case "y":
          value = y;
          break;
        case "rotation":
          value = rotation;
          break;
        case "scale":
          value = scale;
          break;
        default:
          return;
      }

      // Normalize the value based on min and max
      const normalizedValue = (value + 1) * ((max - min) / 2) + min;

      // Invert the value if direction is inverted
      const finalValue =
        direction === GestureDirection.Inverted
          ? max - (normalizedValue - min)
          : normalizedValue;

      updatedFaceValues[key] = finalValue;
    });

    onFaceValuesChange(updatedFaceValues);
  };

  const gestureControlValue = useMemo(() => {
    const gestureValues = selectedControl.values.reduce(
      (acc, { key, min, max, direction, gesture }) => {
        const value = faceValues[key] ?? 0;
        const normalizedValue = (value - min) / (max - min);
        const invertedValue = 1 - normalizedValue;
        const finalValue =
          direction === GestureDirection.Inverted
            ? invertedValue
            : normalizedValue;
        const scaledValue = finalValue * 2 - 1;
        acc[gesture] = scaledValue;
        return acc;
      },
      {} as { [key: string]: number }
    );
    return { x: 0, y: 0, rotation: 0, scale: 0, ...gestureValues };
  }, [faceValues, selectedControl]);

  return (
    <GestureControl
      debug={debug}
      value={gestureControlValue}
      onChange={handleGestureValueChange}
    >
      {imageUrl && <ImageContainer loading={loading} imageUrl={imageUrl} />}
    </GestureControl>
  );
};
