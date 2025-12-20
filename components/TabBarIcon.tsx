import React from 'react';
import { Home, Grid } from 'lucide-react-native';

interface TabBarIconProps {
  name: 'home' | 'grid';
  color: string;
}

export default function TabBarIcon({ name, color }: TabBarIconProps) {
  if (name === 'grid') {
    return <Grid size={20} color={color} />;
  }
  return <Home size={20} color={color} />;
}
