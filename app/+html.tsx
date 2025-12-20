import { PropsWithChildren } from 'react';
import { ScrollView } from 'react-native';

export default function RootHtml({ children }: PropsWithChildren) {
  return <ScrollView>{children}</ScrollView>;
}
