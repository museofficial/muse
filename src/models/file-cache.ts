import {Table, Column, PrimaryKey, Model} from 'sequelize-typescript';

@Table
export default class FileCache extends Model<FileCache> {
  @PrimaryKey
  @Column
  hash!: string;

  @Column
  kbits!: number;

  @Column
  accessedAt!: Date;
}
