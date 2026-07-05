export type NotationMode = 'custom' | 'abc';

export interface NotationDoc {
  title: string;
  subtitle: string;
  meter: string;
  key: string;
  mode: NotationMode;
  text: string;
}

export interface NotationFile {
  id: string;            // filename without .notation
  title: string;
  modifiedAt: number;
  handle: FileSystemFileHandle;
}

export const DEFAULT_DOC: NotationDoc = {
  title: '',
  subtitle: '',
  meter: '4/4',
  key: 'C',
  mode: 'custom',
  text: '',
};

export const EXAMPLE_DOC: NotationDoc = {
  title: 'African Market',
  subtitle: '2. Stimme · in B',
  meter: '4/4',
  key: 'C',
  mode: 'custom',
  text: `4.b 8g 4p 8g g
8.c2 16b b a 8g 4g 8p g
4.a 8g 4p 8b 16b a
8a g 4g 4p 8p g
4.b 8g 4p trio8(g g b)
4.b 8g 4p 16g g 8p
8p 8a a g 4c2 8.b 16a
8p 8g 4g 4p p`,
};
