import { View, Text, Pressable } from 'react-native';
import { Link } from 'expo-router';

export default function NotFoundScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-900 px-6">
      <Text className="text-white text-lg font-bold mb-4">Pantalla no encontrada</Text>
      <Link href="/" asChild>
        <Pressable className="bg-indigo-600 px-4 py-2 rounded-lg">
          <Text className="text-white font-bold">Volver al inicio</Text>
        </Pressable>
      </Link>
    </View>
  );
}
