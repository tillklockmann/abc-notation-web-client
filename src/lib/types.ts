export interface NotationDoc {
  title: string;
  subtitle: string;
  meter: string;
  key: string;
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
  text: '',
};

export const EXAMPLE_DOC: NotationDoc = {
  title: 'African Market',
  subtitle: '2. Stimme · in B',
  meter: '4/4',
  key: 'C',
  text: `B3 G z2 GG | c3/2B/2 B/2A/2G G2 z G | A3 G z2 BB/2A/2 | AG G2 z2 z G |
B3 G z2 (3GGB | B3 G z2 G/2G/2 z | z A AG c2 B3/2A/2 | z G G2 z2 z2 |]`,
};
