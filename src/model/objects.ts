import { ObjectKind } from './types';

export interface ObjectType {
  id: ObjectKind;
  label: string;
  color: string;
  /** these come in linked pairs (the renderer draws an arc between the ends) */
  pairs: boolean;
  hint: string;
}

export const OBJECT_TYPES: ObjectType[] = [
  { id: 'wormhole', label: 'Wormhole', color: '#b58cff', pairs: true, hint: 'Natural pair-linked passage' },
  { id: 'gateway', label: 'Gateway', color: '#7ad6ff', pairs: true, hint: 'Built gate, links to another gate' },
  { id: 'lgate', label: 'L-Gate', color: '#ff8ad0', pairs: false, hint: 'Ancient sealed gate' },
  { id: 'debris', label: 'Debris field', color: '#c0c8d8', pairs: false, hint: 'Wreckage of a battle' },
  { id: 'anomaly', label: 'Anomaly', color: '#6fe3b0', pairs: false, hint: 'Unexplained phenomenon' },
  { id: 'derelict', label: 'Derelict', color: '#d8b168', pairs: false, hint: 'Abandoned construct' },
  { id: 'station', label: 'Station', color: '#8fb4ff', pairs: false, hint: 'Habitat or outpost' },
];

export const OBJECT_BY_ID: Record<string, ObjectType> = Object.fromEntries(
  OBJECT_TYPES.map((o) => [o.id, o])
);
