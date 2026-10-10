export interface OfficialEventOption {
  id: number;
  title: string;
  date: string;
}

export interface GalleryAssociation {
  galleryId: number;
  officialEventId: number | null;
  unavailable: boolean;
}

export interface CommunityGallery {
  id: number;
  title: string;
  date: string;
  creatorId: number;
  creatorName: string;
}
