import { Sequelize } from "sequelize-typescript";
import User from "../models/User";
import Setting from "../models/Setting";
import Contact from "../models/Contact";
import Ticket from "../models/Ticket";
import Whatsapp from "../models/Whatsapp";
import ContactCustomField from "../models/ContactCustomField";
import Message from "../models/Message";
import Queue from "../models/Queue";
import WhatsappQueue from "../models/WhatsappQueue";
import UserQueue from "../models/UserQueue";
import Company from "../models/Company";
import Plan from "../models/Plan";
import TicketNote from "../models/TicketNote";
import QuickMessage from "../models/QuickMessage";
import Help from "../models/Help";
import TicketTraking from "../models/TicketTraking";
import UserRating from "../models/UserRating";
import QueueOption from "../models/QueueOption";
import Schedule from "../models/Schedule";
import Tag from "../models/Tag";
import TicketTag from "../models/TicketTag";
import TicketUser from "../models/TicketUser";
import ContactList from "../models/ContactList";
import ContactListItem from "../models/ContactListItem";
import Campaign from "../models/Campaign";
import CampaignSetting from "../models/CampaignSetting";
import Baileys from "../models/Baileys";
import CampaignShipping from "../models/CampaignShipping";
import Announcement from "../models/Announcement";
import Chat from "../models/Chat";
import ChatUser from "../models/ChatUser";
import ChatMessage from "../models/ChatMessage";
import Invoices from "../models/Invoices";
import Subscriptions from "../models/Subscriptions";
import BaileysChats from "../models/BaileysChats";
import Files from "../models/Files";
import FilesOptions from "../models/FilesOptions";
import Prompt from "../models/Prompt";
import QueueIntegrations from "../models/QueueIntegrations";
import HolidayPeriod from "../models/HolidayPeriod";
import Sticker from "../models/Sticker";
import Service from "../models/Service";
import ServiceProfessional from "../models/ServiceProfessional";
import UserCalendar from "../models/UserCalendar";
import UserWorkingHours from "../models/UserWorkingHours";
import AgentAction from "../models/AgentAction";
import SystemLog from "../models/SystemLog";
import ServiceHistory from "../models/ServiceHistory";
import Coupon from "../models/Coupon";
import BirthdayTouch from "../models/BirthdayTouch";
import PreventiveTouch from "../models/PreventiveTouch";
import LoyaltyReward from "../models/LoyaltyReward";
import WinbackAttempt from "../models/WinbackAttempt";
import Referral from "../models/Referral";
import Package from "../models/Package";
import ClientPackagePurchase from "../models/ClientPackagePurchase";
import PackageConsumption from "../models/PackageConsumption";
import GlobalSetting from "../models/GlobalSetting";
import CalendarProfessional from "../models/CalendarProfessional";
import ProfessionalCalendar from "../models/ProfessionalCalendar";
import ProfessionalWorkingHours from "../models/ProfessionalWorkingHours";

// eslint-disable-next-line
const dbConfig = require("../config/database");
// import dbConfig from "../config/database";

const sequelize = new Sequelize(dbConfig);

const models = [
  Company,
  User,
  Contact,
  Ticket,
  Message,
  Whatsapp,
  ContactCustomField,
  Setting,
  Queue,
  WhatsappQueue,
  UserQueue,
  Plan,
  TicketNote,
  QuickMessage,
  Help,
  TicketTraking,
  UserRating,
  QueueOption,
  Schedule,
  Tag,
  TicketTag,
  TicketUser,
  ContactList,
  ContactListItem,
  Campaign,
  CampaignSetting,
  Baileys,
  CampaignShipping,
  Announcement,
  Chat,
  ChatUser,
  ChatMessage,
  Invoices,
  Subscriptions,
  BaileysChats,
  Files,
  FilesOptions,
  Prompt,
  QueueIntegrations,
  HolidayPeriod,
  Sticker,
  Service,
  ServiceProfessional,
  UserCalendar,
  UserWorkingHours,
  AgentAction,
  SystemLog,
  ServiceHistory,
  Coupon,
  BirthdayTouch,
  PreventiveTouch,
  LoyaltyReward,
  WinbackAttempt,
  Referral,
  Package,
  ClientPackagePurchase,
  PackageConsumption,
  GlobalSetting,
  CalendarProfessional,
  ProfessionalCalendar,
  ProfessionalWorkingHours,
];

sequelize.addModels(models);

export default sequelize;
