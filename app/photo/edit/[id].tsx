import { Text, View, Pressable, StyleSheet } from "react-native";
import { photos } from "../../../data";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { SymbolView } from "expo-symbols";
import { StatusBar } from "expo-status-bar";
import Carousel, { ICarouselInstance } from "react-native-reanimated-carousel";
import { useState, useRef } from "react";

export default function PhotoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const photo = photos.find((p) => p.id === Number.parseInt(id));
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const gesture = Gesture.Pinch()
    .onChange((e) => {
      scale.value = e.scale;
    })
    .onEnd((e) => {
      if (e.velocity < 0) {
        runOnJS(router.back)();
      } else {
        scale.value = withTiming(1);
      }
    });

  if (!photo) {
    return <Text>Photo not found</Text>;
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} />
      <TopBar router={router} />
      <AdjustBar />
      <ImageContainer
        photo={photo}
        gesture={gesture}
        animatedStyle={animatedStyle}
      />
      <BottomPager />
    </View>
  );
}

const TopBar = ({ router }) => (
  <View style={styles.topBar}>
    <Pressable style={styles.topBarButton} onPress={() => router.back()}>
      <Text style={styles.topBarButtonText}>Cancel</Text>
    </Pressable>
    <Pressable style={styles.topBarButtonRed} onPress={() => router.back()}>
      <Text style={styles.topBarButtonTextWhite}>Revert</Text>
    </Pressable>
  </View>
);

const AdjustBar = () => (
  <View style={styles.adjustBar}>
    <View style={styles.rowWithGap}>
      <SymbolView
        name="arrow.uturn.backward.circle"
        weight="regular"
        style={styles.adjustSymbol}
        resizeMode="scaleAspectFit"
      />
      <SymbolView
        name="arrow.uturn.forward.circle"
        weight="regular"
        style={styles.adjustSymbol}
        resizeMode="scaleAspectFit"
      />
    </View>
    <Text style={styles.adjustText}>ADJUST</Text>
    <View style={styles.rowWithGap}>
      <SymbolView
        name="pencil.tip.crop.circle"
        weight="medium"
        style={styles.adjustSymbolActive}
        resizeMode="scaleAspectFit"
      />
      <SymbolView
        name="ellipsis.circle"
        weight="medium"
        style={styles.adjustSymbolActive}
        resizeMode="scaleAspectFit"
      />
    </View>
  </View>
);

const ImageContainer = ({ photo, gesture, animatedStyle }) => (
  <View style={styles.imageContainer}>
    <GestureDetector gesture={gesture}>
      <Animated.Image
        source={photo.image}
        style={[styles.fullSize, animatedStyle]}
        resizeMode="contain"
      />
    </GestureDetector>
  </View>
);

const BottomPager = () => {
  const DATA = [
    { key: "1", icon: "square.and.arrow.up", label: "AUTO" },
    { key: "2", icon: "face.smiling", label: "FACE" },
    { key: "4", icon: "mouth", label: "MOUTH" },
    { key: "3", icon: "eye", label: "EYES" },
    { key: "5", icon: "eyebrow", label: "EYEBROW" },
  ];

  const [selectedLabel, setSelectedLabel] = useState(DATA[0].label);
  const carouselRef = useRef<ICarouselInstance>(null);

  const scrollToIndex = (index: number) => {
    carouselRef.current?.scrollTo({
      index,
      animated: true,
    });
  };

  return (
    <>
      <Text style={styles.selectedLabel}>{selectedLabel}</Text>
      <Carousel
        ref={carouselRef} // Pass the ref to the Carousel component
        style={styles.carousel}
        width={100}
        height={50}
        data={DATA}
        defaultIndex={0}
        loop={false}
        onSnapToItem={(index) => setSelectedLabel(DATA[index].label)}
        renderItem={({ item, animationValue, index }) => (
          <CarouselItem
            animationValue={animationValue}
            icon={item.icon}
            onPress={() => scrollToIndex(index)} // Pass the scrollToIndex function
          />
        )}
      />
    </>
  );
};

const CarouselItem = ({ animationValue, icon, onPress }) => {
  const translateY = useSharedValue(0);

  const containerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      animationValue.value,
      [-1, 0, 1],
      [0.4, 1, 0.4],
      Extrapolation.CLAMP
    );

    return {
      opacity,
    };
  }, [animationValue]);

  const labelStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      animationValue.value,
      [-1, 0, 1],
      [1, 1.25, 1],
      Extrapolation.CLAMP
    );

    return {
      transform: [{ scale }, { translateY: translateY.value }],
    };
  }, [animationValue, translateY]);

  return (
    <Pressable onPress={onPress}>
      <Animated.View
        style={[
          {
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
          },
          containerStyle,
        ]}
      >
        <Animated.Text style={[{ fontSize: 18, color: "#26292E" }, labelStyle]}>
          <SymbolView
            name={icon}
            weight="regular"
            style={styles.adjustSymbolActive}
            resizeMode="scaleAspectFit"
          />
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  adjustBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  adjustSymbol: {
    height: 24,
    width: 24,
    tintColor: "#46454A",
  },
  adjustSymbolActive: {
    height: 24,
    width: 24,
    tintColor: "#8E8D93",
  },
  adjustText: {
    color: "#8E8D93",
    fontWeight: "500",
    fontSize: 14,
  },
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  imageContainer: {
    flex: 1,
  },
  topBarButton: {
    backgroundColor: "#8E8D93",
    borderRadius: 50,
    padding: 7,
    paddingHorizontal: 12,
  },
  topBarButtonRed: {
    backgroundColor: "red",
    borderRadius: 50,
    padding: 7,
    paddingHorizontal: 12,
  },
  topBarButtonTextWhite: {
    fontWeight: "700",
    color: "#FFF",
  },
  rowWithGap: {
    flexDirection: "row",
    gap: 15,
  },
  topBarButtonText: {
    fontWeight: "700",
  },
  symbol: {
    height: 28,
    width: 28,
  },
  photoInfo: {
    flexDirection: "column",
    gap: 3,
  },
  topSymbol: {
    height: 15,
    width: 15,
  },
  topButton: {
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    borderRadius: 50,
    padding: 6,
  },
  topButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 7,
  },
  closeButton: {
    position: "absolute",
    top: 40,
    left: 20,
    zIndex: 1,
    padding: 10,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 5,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 15,
    width: "100%",
    zIndex: 1,
    paddingHorizontal: 40,
  },
  titleText: {
    color: "#000",
    fontWeight: "bold",
    fontSize: 20,
  },
  subheadingText: {
    color: "rgba(0, 0, 0, 0.5)",
    fontWeight: "light",
    fontSize: 12,
  },
  carousel: {
    width: "100%",
    height: 50,
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  fullSize: {
    width: "100%",
    height: "100%",
  },
  iconButton: {
    marginHorizontal: 10,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    borderRadius: 25,
    padding: 10,
  },
  selectedLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "thin",
    textAlign: "center",
    margin: 10,
  },
});
