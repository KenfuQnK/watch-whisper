import React from 'react';
import { Image, Pressable, View } from 'react-native';
import { User } from '../types';

interface AvatarProps {
  user: User;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: () => void;
  selected?: boolean;
}

const Avatar: React.FC<AvatarProps> = ({ user, size = 'md', className = '', onClick, selected = false }) => {
  const sizeClasses = {
    sm: 'w-8 h-8 border-2',
    md: 'w-12 h-12 border-2',
    lg: 'w-20 h-20 border-4',
  };

  const selectedRing = selected ? 'ring-4 ring-offset-2 ring-offset-slate-900 ring-green-500' : '';
  const notSelectedStyle = onClick && !selected ? 'opacity-70' : '';

  return (
    <Pressable onPress={onClick}>
      <View
        className={`relative rounded-full overflow-hidden ${sizeClasses[size]} border-slate-800 ${selectedRing} ${notSelectedStyle} ${className}`}
        style={{ backgroundColor: user.color }}
      >
        <Image source={{ uri: user.avatar }} style={{ width: '100%', height: '100%' }} />
      </View>
    </Pressable>
  );
};

export default Avatar;
