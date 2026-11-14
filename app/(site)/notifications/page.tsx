import type {Metadata} from "next";
import {SiteHeader} from "@/components/site-header";
import NotificationCenter from "@/components/notification-center";
export const metadata:Metadata={title:"Notifications — SingMotion AI",description:"Your SingMotion AI account notifications."};
export default function NotificationsPage(){
 return <div className="sm-carousel-page"><SiteHeader/><NotificationCenter/></div>;
}
