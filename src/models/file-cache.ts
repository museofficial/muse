import {Table, Column, PrimaryKey, Model} from 'sequelize-typescript';

@Table
export default class FileCache extends Model {
  @PrimaryKey
  @Column
  hash!: string;

  @Column
  bytes!: number;

  @Column
  accessedAt!: Date;
}
