export type Subject = {
  id: number;
  name: string;
  name_cn?: string;
  type?: number;
  platform?: string;
  images?: { large?: string; common?: string; medium?: string };
  summary?: string;
  date?: string;
  air_date?: string;
  eps?: number;
  total_episodes?: number;
  rating?: {
    score: number;
    rank?: number;
    total?: number;
    count?: Record<string, number>;
  };
  rank?: number;
  tags?: { name: string; count: number }[];
  collection?: { doing?: number; wish?: number; collect?: number };
  infobox?: { key: string; value: string | { v: string }[] }[];
};
export type Episode = {
  id: number;
  sort: number;
  name: string;
  name_cn: string;
  airdate: string;
  type: number;
};
export type Character = {
  id: number;
  name: string;
  role: string;
  images?: { medium: string };
  actors?: { id: number; name: string }[];
};
export type CalendarDay = {
  weekday: { id: number; cn: string; en: string };
  items: Subject[];
};
export type Saved = {
  rate?: number;
  comment?: string;
  subject: Subject;
  status: "wish" | "doing" | "done" | "hold" | "dropped";
  watched: number[];
  updated: number;
  watchedCount?: number;
  episodesLoaded?: boolean;
};
export type User = {
  id: number;
  username: string;
  nickname: string;
  avatar?: { medium: string; small: string };
};
export type Session = { token: string; user: User };
export type RemoteCollection = {
  rate?: number;
  comment?: string;
  subject_id: number;
  subject_type: number;
  type: number;
  ep_status: number;
  updated_at: string;
  subject: Subject & { score?: number };
  private: boolean;
};
export type Review = { rate: number; comment: string };
export type RemoteEpisodes = {
  data: { episode: Episode; type: number }[];
  total: number;
};
export type Page = {
  data: Subject[];
  total: number;
  limit: number;
  offset: number;
};
