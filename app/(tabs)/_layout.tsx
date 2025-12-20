import { Tabs } from 'expo-router';
import TabBarIcon from '../../components/TabBarIcon';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#0f172a' },
        tabBarActiveTintColor: '#fff',
        tabBarInactiveTintColor: '#94a3b8',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => <TabBarIcon name="home" color={color} />
        }}
      />
      <Tabs.Screen
        name="two"
        options={{
          title: 'Más',
          tabBarIcon: ({ color }) => <TabBarIcon name="grid" color={color} />
        }}
      />
    </Tabs>
  );
}
