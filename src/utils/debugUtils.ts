import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface SocketStatistics {
  error: boolean;
  version: string | null;
  statistics?: {
    total: number;
    tcp: {
      total: number;
      estab: number;
      closed: number;
      orphaned: number;
      timewait: number;
    };
  };
  message?: string;
}

async function getSocketStatistics(): Promise<SocketStatistics> {
  try {
    const { stdout } = await execAsync('ss -s');
    const lines = stdout.trim().split('\n');

    const totalLine = lines.find((line) => line.startsWith('Total:')) || '';
    const tcpLine = lines.find((line) => line.startsWith('TCP:')) || '';

    const [, total] = totalLine.match(/Total:\s+(\d+)/) || [];
    const [, tcp, estab, closed, orphaned, timewait] =
      tcpLine.match(
        /TCP:\s+(\d+)\s+\(estab\s+(\d+),\s+closed\s+(\d+),\s+orphaned\s+(\d+),\s+timewait\s+(\d+)\)/
      ) || [];

    const result: SocketStatistics = {
      error: false,
      version: null,
      statistics: {
        total: parseInt(total || '0', 10),
        tcp: {
          total: parseInt(tcp || '0', 10),
          estab: parseInt(estab || '0', 10),
          closed: parseInt(closed || '0', 10),
          orphaned: parseInt(orphaned || '0', 10),
          timewait: parseInt(timewait || '0', 10),
        },
      },
    };

    return result;
  } catch (error) {
    const result: SocketStatistics = {
      error: true,
      version: null,
      message: error.message,
    };

    return result;
  }
}

async function getVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('ss -V');
    const version = stdout.trim();
    return version;
  } catch (error) {
    //console.error('Error retrieving version:', error)
    return null;
  }
}

// async function main() {
//   const socketStatistics = await getSocketStatistics();
//   const version = await getVersion();
//   socketStatistics.version = version;
//   console.log(JSON.stringify(socketStatistics, null, 2));
// }

// main().catch((error) => {
//   console.error('An error occurred:', error);
// });

export async function getSocketReport(): Promise<SocketStatistics> {
  const socketStatistics = await getSocketStatistics();
  const version = await getVersion();
  socketStatistics.version = version;
  //console.log(JSON.stringify(socketStatistics, null, 2))
  return socketStatistics;
}
