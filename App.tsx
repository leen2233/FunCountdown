/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useState, useEffect } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Platform,
  TextInput,
  PermissionsAndroid,
  Alert,
  ScrollView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { differenceInDays, format, isSameDay } from 'date-fns';
import axios from 'axios';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HUGGING_FACE_API_TOKEN = '';
const CHAT_MODEL = 'meta-llama/Llama-3.2-3B-Instruct';

interface CountdownData {
  targetDate: string;
  eventDescription: string;
  imageStyle?: string;
  lastGeneratedDate?: string;
  cachedImagePath?: string;
}

const App = () => {
  const [targetDate, setTargetDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [countdownImage, setCountdownImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [eventDescription, setEventDescription] = useState('');
  const [imageStyle, setImageStyle] = useState('');
  const [saving, setSaving] = useState(false);
  const [isSetup, setIsSetup] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    loadCountdownData();
  }, []);

  const loadCountdownData = async () => {
    try {
      const data = await AsyncStorage.getItem('countdownData');
      if (data) {
        const countdown: CountdownData = JSON.parse(data);
        setTargetDate(new Date(countdown.targetDate));
        setEventDescription(countdown.eventDescription);
        setImageStyle(countdown.imageStyle || '');
        setIsSetup(true);

        // Check if we need to generate a new daily image
        if (
          !countdown.lastGeneratedDate ||
          !countdown.cachedImagePath ||
          !isSameDay(new Date(countdown.lastGeneratedDate), new Date())
        ) {
          // Generate new daily image
          const daysLeft = differenceInDays(
            new Date(countdown.targetDate),
            new Date(),
          );
          if (daysLeft >= 0) {
            await generateCountdownImage(daysLeft);
          }
        } else {
          // Use cached image
          setCountdownImage(countdown.cachedImagePath);
        }
      }
    } catch (error) {
      console.error('Error loading countdown data:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  const saveCountdownData = async () => {
    try {
      const data: CountdownData = {
        targetDate: targetDate.toISOString(),
        eventDescription,
        imageStyle,
        lastGeneratedDate: new Date().toISOString(),
        cachedImagePath: countdownImage || undefined,
      };
      await AsyncStorage.setItem('countdownData', JSON.stringify(data));
      setIsSetup(true);
    } catch (error) {
      console.error('Error saving countdown data:', error);
      Alert.alert('Error', 'Failed to save countdown data');
    }
  };

  const requestStoragePermission = async () => {
    if (Platform.OS !== 'android') return true;

    try {
      if (Platform.Version >= 33) {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      console.error('Failed to request permission:', err);
      return false;
    }
  };

  const saveImage = async () => {
    if (!countdownImage) return;

    try {
      setSaving(true);
      const hasPermission = await requestStoragePermission();

      if (!hasPermission) {
        Alert.alert('Permission Denied', 'Please grant storage permission to save images.');
        return;
      }

      const timestamp = new Date().getTime();
      const fileName = `countdown_${timestamp}.jpg`;
      const destPath = `${RNFS.PicturesDirectoryPath}/${fileName}`;

      await RNFS.copyFile(countdownImage.replace('file://', ''), destPath);

      Alert.alert('Success', 'Image saved to gallery!');
    } catch (error) {
      console.error('Error saving image:', error);
      Alert.alert('Error', 'Failed to save image');
    } finally {
      setSaving(false);
    }
  };

  const generatePrompt = async (description: string, daysLeft: number) => {
    try {
      const stylePrompt = imageStyle
        ? `. The image should be in ${imageStyle} style`
        : '';

      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${CHAT_MODEL}/v1/chat/completions`,
        {
          model: CHAT_MODEL,
          messages: [
            {
              role: 'user',
              content: `Generate a creative and descriptive prompt for an AI image generator. The image should represent a countdown to an event. Context: Someone is waiting for "${description}" and there are ${daysLeft} days remaining. The image should include the number ${daysLeft} and be visually appealing${stylePrompt}. Make the prompt specific and artistic. Respond with only the prompt text, no additional commentary.`,
            },
          ],
          max_tokens: 200,
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${HUGGING_FACE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const prompt = response.data?.choices?.[0]?.message?.content || '';
      const cleanPrompt = prompt
        .replace(/^['"]*/, '')
        .replace(/['"]*$/, '')
        .trim();

      console.log('Generated prompt:', cleanPrompt);
      return cleanPrompt || `A beautiful digital art showing number ${daysLeft} days remaining until ${description}, creative and colorful${stylePrompt}`;
    } catch (error) {
      console.error('Error generating prompt:', error);
      return `A beautiful digital art showing number ${daysLeft} days remaining until ${description}, creative and colorful`;
    }
  };

  const generateCountdownImage = async (daysLeft: number) => {
    setLoading(true);
    try {
      const imagePrompt = await generatePrompt(eventDescription, daysLeft);
      console.log('Using prompt for image:', imagePrompt);

      const response = await axios({
        method: 'post',
        url: 'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-dev',
        data: {
          inputs: imagePrompt,
        },
        headers: {
          Authorization: `Bearer ${HUGGING_FACE_API_TOKEN}`,
        },
        responseType: 'arraybuffer',
      });

      const buffer = response.data;
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Data = btoa(binary);

      const tempFilePath = `${RNFS.CachesDirectoryPath}/countdown_${Date.now()}.jpg`;
      await RNFS.writeFile(tempFilePath, base64Data, 'base64');
      setCountdownImage(`file://${tempFilePath}`);

      // Update cached image path in storage
      const data = await AsyncStorage.getItem('countdownData');
      if (data) {
        const countdown: CountdownData = JSON.parse(data);
        countdown.cachedImagePath = `file://${tempFilePath}`;
        countdown.lastGeneratedDate = new Date().toISOString();
        await AsyncStorage.setItem('countdownData', JSON.stringify(countdown));
      }
    } catch (error) {
      console.error('Error generating image:', error);
    } finally {
      setLoading(false);
    }
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    setShowPicker(false);
    if (selectedDate) {
      setTargetDate(selectedDate);
    }
  };

  const daysRemaining = differenceInDays(targetDate, new Date());

  if (initialLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

  if (!isSetup) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView>
          <Text style={styles.title}>Setup Countdown</Text>

          <Text style={styles.label}>What are you waiting for?</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter event description"
            value={eventDescription}
            onChangeText={setEventDescription}
          />

          <Text style={styles.label}>Target Date</Text>
          <TouchableOpacity
            style={styles.dateButton}
            onPress={() => setShowPicker(true)}>
            <Text style={styles.dateButtonText}>
              {format(targetDate, 'MMM dd, yyyy')}
            </Text>
          </TouchableOpacity>

          <Text style={styles.label}>Image Style (Optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., anime, watercolor, pixel art"
            value={imageStyle}
            onChangeText={setImageStyle}
          />

          {showPicker && (
            <DateTimePicker
              value={targetDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onDateChange}
              minimumDate={new Date()}
            />
          )}

          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.setupButton,
              (!eventDescription || daysRemaining < 0) && styles.disabledButton,
            ]}
            disabled={!eventDescription || daysRemaining < 0}
            onPress={async () => {
              const daysLeft = differenceInDays(targetDate, new Date());
              await generateCountdownImage(daysLeft);
              await saveCountdownData();
            }}>
            <Text style={styles.actionButtonText}>Start Countdown</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.title}>Fun Countdown</Text>

        <View style={styles.countdownContainer}>
          {daysRemaining >= 0 ? (
            <Text style={styles.countdownText}>
              {daysRemaining} days until {eventDescription}
            </Text>
          ) : (
            <Text style={styles.countdownText}>Date has passed!</Text>
          )}
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#0000ff" />
        ) : (
          countdownImage && (
            <View style={styles.imageContainer}>
              <Image
                source={{ uri: countdownImage }}
                style={styles.generatedImage}
                resizeMode="contain"
              />
              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.regenerateButton]}
                  onPress={() => {
                    if (daysRemaining >= 0) {
                      generateCountdownImage(daysRemaining);
                    }
                  }}>
                  <Text style={styles.actionButtonText}>🔄 Regenerate</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.saveButton]}
                  onPress={saveImage}
                  disabled={saving}>
                  <Text style={styles.actionButtonText}>
                    {saving ? 'Saving...' : '💾 Save Image'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 20,
    marginBottom: 8,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 15,
    marginHorizontal: 20,
    marginBottom: 20,
    fontSize: 16,
  },
  dateButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    marginHorizontal: 20,
    marginBottom: 20,
  },
  dateButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
  },
  countdownContainer: {
    alignItems: 'center',
    marginVertical: 20,
    paddingHorizontal: 20,
  },
  countdownText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
  },
  imageContainer: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  generatedImage: {
    width: '100%',
    height: 300,
    borderRadius: 10,
    marginTop: 20,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginTop: 15,
    marginBottom: 20,
  },
  actionButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 140,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  regenerateButton: {
    backgroundColor: '#34C759',
  },
  saveButton: {
    backgroundColor: '#5856D6',
  },
  setupButton: {
    backgroundColor: '#007AFF',
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 30,
  },
  disabledButton: {
    opacity: 0.5,
  },
});

export default App;
