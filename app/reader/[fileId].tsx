import { useLocalSearchParams } from 'expo-router';

import { parseFileIdParam } from '@/features/reader/navigation';
import { ReaderScreen } from '@/features/reader/ReaderScreen';

export default function ReaderRoute() {
  const { fileId } = useLocalSearchParams<{ fileId: string }>();
  const id = parseFileIdParam(fileId);
  // Keyed by file: opening another file from here starts a fresh reader.
  return <ReaderScreen key={id ?? 'invalid'} fileId={id} />;
}
