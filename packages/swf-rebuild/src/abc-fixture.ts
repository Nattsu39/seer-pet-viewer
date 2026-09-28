import { Buffer } from 'buffer';
import { u16 } from './binary.js';

/** 小型 ABC 表合成样例；不包含游戏代码或资源。 */
export function stubFixture(): { abc: Buffer; operandOffsets: number[] } {
  const strings = ['Example', 'addFrameScript', 'frame1', 'frame2', 'frame3'];
  const pool = [
    Buffer.from([0, 0, 0, strings.length + 1]),
    ...strings.map((value) =>
      Buffer.concat([Buffer.from([value.length]), Buffer.from(value)]),
    ),
    Buffer.from([2, 0x16, 0, 0, 6]),
    ...strings.map((_, i) => Buffer.from([7, 1, i + 1])),
  ];
  const tables = Buffer.from([
    1,
    0,
    0,
    0,
    0, // 一个没有参数的 method_info。
    0, // 元数据数量。
    1,
    1,
    0,
    0,
    0,
    0,
    0, // 一个实例：名称 1、父类 *、标志、接口、实例初始化器和特征。
    0,
    0, // 类初始化器和特征。
    0, // 脚本数量。
    1,
    0,
    7,
    1,
    0,
    1, // 一个方法体及其限制。
  ]);
  const code = Buffer.from([
    0xd0, 0x30, 0xd0, 0x49, 0, 0x5d, 2, 0x24, 0, 0xd0, 0x66, 3, 0x24, 1, 0xd0,
    0x66, 4, 0x24, 2, 0xd0, 0x66, 5, 0x4f, 2, 6, 0x47,
  ]);
  const prefix = Buffer.concat([
    u16(16),
    u16(46),
    ...pool,
    tables,
    Buffer.from([code.length]),
  ]);
  return {
    abc: Buffer.concat([prefix, code, Buffer.from([0, 0])]),
    operandOffsets: [8, 13, 18].map((offset) => prefix.length + offset),
  };
}
