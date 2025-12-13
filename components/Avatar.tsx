import React from 'react';
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
    sm: 'w-8 h-8 border-2', // Was w-6 h-6
    md: 'w-12 h-12 border-2', // Was w-10 h-10
    lg: 'w-20 h-20 border-4', // Was w-16 h-16
  };

  const selectedRing = selected ? 'ring-4 ring-offset-2 ring-offset-slate-900 ring-green-500' : 'opacity-100';
  const notSelectedStyle = onClick && !selected ? 'opacity-50 grayscale hover:opacity-80 hover:grayscale-0' : '';

  return (
    <div 
      className={`relative rounded-full overflow-hidden ${sizeClasses[size]} border-slate-800 ${selectedRing} ${notSelectedStyle} ${className} transition-all duration-300 cursor-pointer`}
      style={{ backgroundColor: user.color }}
      onClick={onClick}
      title={user.name}
    >
      <img 
        src={user.avatar} 
        alt={user.name} 
        className="w-full h-full object-cover"
      />
    </div>
  );
};

export default Avatar;