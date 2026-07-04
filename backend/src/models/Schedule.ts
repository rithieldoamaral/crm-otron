import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  DataType,
  BelongsTo,
  ForeignKey
} from "sequelize-typescript";
import Company from "./Company";
import Contact from "./Contact";
import Ticket from "./Ticket";
import User from "./User";
import Service from "./Service";


@Table
class Schedule extends Model<Schedule> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column(DataType.TEXT)
  body: string;

  @Column
  sendAt: Date;

  @Column
  sentAt: Date;

  @ForeignKey(() => Contact)
  @Column
  contactId: number;

  @ForeignKey(() => Ticket)
  @Column
  ticketId: number;

  @ForeignKey(() => User)
  @Column
  userId: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @Column(DataType.STRING)
  status: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @Column
  geral: boolean;

  @Column
  queueId: number;

  @Column
  whatsappId: number;

  @BelongsTo(() => Contact, "contactId")
  contact: Contact;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @BelongsTo(() => User)
  user: User;

  @BelongsTo(() => Company)
  company: Company;

  @Column
  mediaPath: string;
  
  @Column
  mediaName: string;

  @Column
  repeatEvery: string;

  @Column
  repeatCount: string;

  @Column
  selectDaysRecorrenci: string;

  @ForeignKey(() => Service)
  @Column
  serviceId: number;

  @BelongsTo(() => Service)
  service: Service;

  // ID do profissional responsável (userId do atendente)
  @Column
  professionalId: number;

  @Column
  googleEventId: string;

  // pending | confirmed | cancelled | no_response
  @Column
  reminderStatus: string;

  @Column
  reminderSentAt: Date;

  @Column
  confirmedAt: Date;
}

export default Schedule;
