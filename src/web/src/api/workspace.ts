import {
  ListPagesResponse,
  CreatePageRequest,
  CreatePageResponse,
  GetPageResponse,
  UpdatePageRequest,
  UpdatePageResponse,
  ArchivePageResponse,
  OpsRequest,
  PageOpsResponse,
  SearchResponse,
  UploadResponse,
  ListChangesetsResponse,
  UndoChangesetResponse,
  GetRowResponse,
  RowOpsResponse,
} from '@fortnight/shared';
import { request } from './client';
const id = encodeURIComponent;
export const workspaceApi = {
  pages: (signal?: AbortSignal) => request('/pages', ListPagesResponse, { signal }),
  page: (pageId: string, signal?: AbortSignal) =>
    request('/pages/' + id(pageId), GetPageResponse, { signal }),
  row: (rowId: string, signal?: AbortSignal) =>
    request('/rows/' + id(rowId), GetRowResponse, { signal }),
  create: (body: CreatePageRequest) =>
    request('/pages', CreatePageResponse, {
      method: 'POST',
      body: JSON.stringify(CreatePageRequest.parse(body)),
    }),
  update: (pageId: string, body: UpdatePageRequest) =>
    request('/pages/' + id(pageId), UpdatePageResponse, {
      method: 'PATCH',
      body: JSON.stringify(UpdatePageRequest.parse(body)),
    }),
  archive: (pageId: string) =>
    request('/pages/' + id(pageId) + '/archive', ArchivePageResponse, { method: 'POST' }),
  restore: (pageId: string) =>
    request('/pages/' + id(pageId) + '/restore', ArchivePageResponse, { method: 'POST' }),
  ops: (pageId: string, ops: OpsRequest['ops'], label?: string) =>
    request('/pages/' + id(pageId) + '/ops', PageOpsResponse, {
      method: 'POST',
      body: JSON.stringify(OpsRequest.parse({ ops, label })),
    }),
  rowOps: (rowId: string, ops: OpsRequest['ops'], label?: string) =>
    request('/rows/' + id(rowId) + '/ops', RowOpsResponse, {
      method: 'POST',
      body: JSON.stringify(OpsRequest.parse({ ops, label })),
    }),
  search: (query: string, signal?: AbortSignal) =>
    request('/search?q=' + id(query) + '&limit=20', SearchResponse, { signal }),
  upload: (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return request('/uploads', UploadResponse, { method: 'POST', body });
  },
  changesets: () => request('/changesets?limit=10', ListChangesetsResponse),
  undo: (changeId: string) =>
    request('/changesets/' + id(changeId) + '/undo', UndoChangesetResponse, { method: 'POST' }),
};
