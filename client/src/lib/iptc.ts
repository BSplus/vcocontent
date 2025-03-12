// Simplified browser-compatible IPTC metadata extraction
export interface IPTCMetadata {
  caption?: string;
  photographer?: string;
  tags?: string[];
}

export async function extractIPTCMetadata(file: File): Promise<IPTCMetadata> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const result = e.target?.result;
      if (!result) {
        resolve({});
        return;
      }

      // Basic IPTC extraction using binary search
      const buffer = new Uint8Array(result as ArrayBuffer);
      const metadata: IPTCMetadata = {};

      // Search for IPTC marker
      let i = 0;
      while (i < buffer.length - 1) {
        if (buffer[i] === 0x1C && buffer[i + 1] === 0x02) {
          // Found an IPTC marker
          const recordNumber = buffer[i + 2];
          const datasetNumber = buffer[i + 3];
          const length = (buffer[i + 4] << 8) + buffer[i + 5];
          const data = buffer.slice(i + 6, i + 6 + length);

          // Convert to string
          const value = new TextDecoder().decode(data);

          // Map IPTC records to our metadata structure
          if (recordNumber === 2) {
            switch (datasetNumber) {
              case 120: // Caption
                metadata.caption = value;
                break;
              case 80: // By-line (photographer)
                metadata.photographer = value;
                break;
              case 25: // Keywords
                metadata.tags = metadata.tags || [];
                metadata.tags.push(value);
                break;
            }
          }

          i += 6 + length;
        } else {
          i++;
        }
      }

      resolve(metadata);
    };

    reader.readAsArrayBuffer(file);
  });
}