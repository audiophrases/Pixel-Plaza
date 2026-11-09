import { createContext } from 'react';
import type { CastMember } from '../../shared/campaign';

// The story's characters, for every StoryText below: given once by the Journal or the instructions.
export const CastContext = createContext<readonly CastMember[]>([]);
