
export type NodeType = 'Concept'
                     | 'ConceptScheme'
                     | 'Term'
                     | 'Collection'
                     | 'Group';

export interface Identifier<T> {

  id: string;
  type: {
    id: T;
    graph: { id: string; }
  }
}

export interface Attribute {

  lang?: string;
  regex?: string;
  value: string;
}

export interface NodeExternal<T extends NodeType> extends Identifier<T> {

  code: string;
  createdBy: string;
  createdDate: string;
  lastModifiedBy: string;
  lastModifiedDate: string;
  uri: string;

  properties: { [key: string]: Attribute[] };
  references: { [key: string]: NodeExternal<any>[] };
  referrers: { [key: string]: NodeExternal<any>[] };
}

export interface NodeInternal<T extends NodeType> extends Identifier<T> {

  code: string;
  createdBy: string;
  createdDate: string;
  lastModifiedBy: string;
  lastModifiedDate: string;
  uri: string;

  properties: { [key: string]: Attribute[] };
  references: { [key: string]: Identifier<string>[] };
  referrers: { [key: string]: Identifier<string>[] };
}
